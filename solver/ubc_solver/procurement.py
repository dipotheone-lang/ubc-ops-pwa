"""Procurement award optimizer (MILP).

Decides, for every material-requisition line, which supplier(s) supply it and in
what quantity, minimising total *effective* cost:

  price (with volume tiers) + delivery + supplier-risk premium
  - financing benefit of longer payment terms
  + lateness penalty (vs. the site's required date)
  + fixed cost per (MR, supplier) order
  + big penalties for unmet quantity / budget overrun (keeps model always feasible)

Hard constraints: approved-supplier list, MOQ, supplier capacity (shared across
all lines/MRs), max suppliers per MR, supplier minimum order value.

Input/Output are plain JSON-able dicts (see examples/demo_input.json).
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from ortools.linear_solver import pywraplp

PRIORITY_WEIGHT = {"Low": 0.5, "Normal": 1.0, "High": 2.0, "Urgent": 4.0}

DEFAULT_PARAMS = {
    "allow_conditional": False,      # allow suppliers with avl_status == "Conditional"
    "late_penalty_pct_per_day": 0.5,  # % of unit price per late day (x priority weight)
    "max_late_days": None,           # exclude offers later than this (None = no limit)
    "fixed_order_cost": 500.0,       # per (MR, supplier) PO issued
    "max_suppliers_per_mr": 3,
    "financing_rate": 0.24,          # annual cost of capital (EGP-ish); benefit of payment terms
    "rating_risk_pct": 3.0,          # premium % for a 0-star supplier, scaled linearly to 0 at 5 stars
    "vat_rate": 0.14,
    "shortage_multiplier": 5.0,      # penalty per unmet unit = multiplier x reference price
    "budget_overrun_multiplier": 1.5,   # per EGP over budget; must stay < shortage_multiplier so we buy and warn
    "time_limit_s": 30,
    "backend": "SCIP",
}


class InputError(ValueError):
    pass


def load_input(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _d(v: Any) -> date:
    if isinstance(v, date):
        return v
    return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()


def _validate(data: dict) -> None:
    for key in ("suppliers", "requirements", "offers"):
        if not isinstance(data.get(key), list):
            raise InputError(f"'{key}' must be a list")
    if "as_of" not in data:
        raise InputError("'as_of' (YYYY-MM-DD) is required")
    seen = set()
    for r in data["requirements"]:
        for k in ("line_id", "mr_id", "project_id", "item", "qty", "required_date"):
            if k not in r:
                raise InputError(f"requirement missing '{k}': {r}")
        if r["qty"] <= 0:
            raise InputError(f"qty must be > 0 for line {r['line_id']}")
        if r["line_id"] in seen:
            raise InputError(f"duplicate line_id {r['line_id']}")
        seen.add(r["line_id"])
    sup_ids = {s["id"] for s in data["suppliers"]}
    for o in data["offers"]:
        if o.get("supplier_id") not in sup_ids:
            raise InputError(f"offer references unknown supplier {o.get('supplier_id')}")
        if not o.get("tiers"):
            raise InputError(f"offer needs at least one price tier: {o}")


def _tiers(offer: dict) -> list[tuple[float, float, float]]:
    """-> [(lo, hi, unit_price)] with hi exclusive (inf for last tier), lo >= moq."""
    ts = sorted(((float(t.get("min_qty", 0)), float(t["unit_price"])) for t in offer["tiers"]))
    moq = float(offer.get("moq", 0) or 0)
    out = []
    for i, (lo, price) in enumerate(ts):
        hi = ts[i + 1][0] - 1e-3 if i + 1 < len(ts) else float("inf")
        lo = max(lo, moq)
        if lo <= hi:
            out.append((lo, hi, price))
    return out


def optimize_procurement(data: dict, **overrides) -> dict:
    _validate(data)
    P = {**DEFAULT_PARAMS, **data.get("params", {}), **overrides}
    as_of = _d(data["as_of"])

    sup = {s["id"]: s for s in data["suppliers"]}
    ok_status = {"Approved"} | ({"Conditional"} if P["allow_conditional"] else set())
    warnings: list[str] = []

    offers_by_item: dict[str, list[dict]] = defaultdict(list)
    for idx, o in enumerate(data["offers"]):
        s = sup[o["supplier_id"]]
        if s.get("avl_status", "Approved") not in ok_status or s.get("status", "Active") != "Active":
            continue
        if o.get("valid_until") and _d(o["valid_until"]) < as_of:
            continue
        o = {**o, "_idx": idx}
        offers_by_item[o["item"]].append(o)

    solver = pywraplp.Solver.CreateSolver(P["backend"]) or pywraplp.Solver.CreateSolver("CBC")
    if solver is None:
        raise RuntimeError("No MILP backend available in OR-Tools")
    inf = solver.infinity()
    obj = solver.Objective()

    # ---- variables ---------------------------------------------------------
    alts: list[dict] = []                       # one per (line, offer, tier)
    by_line: dict[str, list[dict]] = defaultdict(list)
    by_offer: dict[int, list[dict]] = defaultdict(list)
    by_mr_sup: dict[tuple, list[dict]] = defaultdict(list)
    by_project: dict[str, list[dict]] = defaultdict(list)
    shortage: dict[str, Any] = {}
    ref_price: dict[str, float] = {}

    for r in data["requirements"]:
        avail_days = (_d(r["required_date"]) - as_of).days
        w = PRIORITY_WEIGHT.get(r.get("priority", "Normal"), 1.0)
        cands = offers_by_item.get(r["item"], [])
        prices = [t[2] for o in cands for t in _tiers(o)]
        ref = min(prices) if prices else float(r.get("est_unit_price") or 0)
        ref = max(ref, float(r.get("est_unit_price") or 0), 1e-6)
        ref_price[r["line_id"]] = ref

        for o in cands:
            lead = int(o.get("lead_days", 0) or 0)
            late = max(0, lead - avail_days)
            if P["max_late_days"] is not None and late > P["max_late_days"]:
                continue
            s = sup[o["supplier_id"]]
            risk = P["rating_risk_pct"] / 100.0 * max(0.0, 5.0 - float(s.get("rating", 5))) / 5.0
            fin = P["financing_rate"] / 365.0 * float(o.get("payment_days", 0) or 0)
            for ti, (lo, hi, price) in enumerate(_tiers(o)):
                if lo > r["qty"] + 1e-9 and lo > 0:
                    continue  # tier unreachable for this line (still could pool, but keep simple)
                cap = float(o.get("capacity") or inf)
                ub = min(hi, r["qty"], cap)
                if ub < lo:
                    continue
                eff_unit = (price * (1 + risk) * (1 - min(fin, 0.5))
                            + float(o.get("delivery_cost_per_unit", 0) or 0)
                            + price * P["late_penalty_pct_per_day"] / 100.0 * late * w)
                x = solver.NumVar(0, ub, f"x_{r['line_id']}_{o['_idx']}_{ti}")
                y = solver.IntVar(0, 1, f"y_{r['line_id']}_{o['_idx']}_{ti}")
                solver.Add(x <= ub * y)
                solver.Add(x >= lo * y)
                a = dict(line=r, offer=o, tier=ti, price=price, x=x, y=y, late=late,
                         eff_unit=eff_unit, lo=lo, ub=ub)
                alts.append(a)
                by_line[r["line_id"]].append(a)
                by_offer[o["_idx"]].append(a)
                by_mr_sup[(r["mr_id"], o["supplier_id"])].append(a)
                by_project[r["project_id"]].append(a)
                obj.SetCoefficient(x, obj.GetCoefficient(x) + eff_unit)
            # one tier per (line, offer)
        for o in cands:
            ys = [a["y"] for a in by_line[r["line_id"]] if a["offer"]["_idx"] == o["_idx"]]
            if len(ys) > 1:
                solver.Add(sum(ys) <= 1)

        # coverage with shortage slack
        sh = solver.NumVar(0, r["qty"], f"short_{r['line_id']}")
        shortage[r["line_id"]] = sh
        solver.Add(sum(a["x"] for a in by_line[r["line_id"]]) + sh == r["qty"])
        obj.SetCoefficient(sh, P["shortage_multiplier"] * ref)

    # supplier capacity shared across all lines
    for oi, lst in by_offer.items():
        cap = data["offers"][oi].get("capacity")
        if cap:
            solver.Add(sum(a["x"] for a in lst) <= float(cap))

    # per (MR, supplier) order: fixed cost, min order value, supplier count
    u: dict[tuple, Any] = {}
    for key, lst in by_mr_sup.items():
        mr, sid = key
        u[key] = solver.IntVar(0, 1, f"u_{mr}_{sid}")
        for a in lst:
            solver.Add(a["y"] <= u[key])
        fixed = float(sup[sid].get("fixed_order_cost", P["fixed_order_cost"]))
        obj.SetCoefficient(u[key], fixed)
        mov = float(sup[sid].get("min_order_value", 0) or 0)
        if mov > 0:
            big = sum(a["ub"] * a["price"] for a in lst)
            spend = sum(a["x"] * a["price"] for a in lst)
            solver.Add(spend >= mov * u[key])
            solver.Add(spend <= big * u[key])
        else:
            for a in lst:
                solver.Add(a["x"] <= a["ub"] * u[key])
    per_mr = defaultdict(list)
    for (mr, sid), var in u.items():
        per_mr[mr].append(var)
    for mr, vs in per_mr.items():
        solver.Add(sum(vs) <= int(P["max_suppliers_per_mr"]))

    # project budgets (soft with heavy penalty)
    over: dict[str, Any] = {}
    for pid, budget in (data.get("budgets") or {}).items():
        lst = by_project.get(pid, [])
        if not lst:
            continue
        ov = solver.NumVar(0, inf, f"over_{pid}")
        over[pid] = ov
        solver.Add(sum(a["x"] * (a["price"] + float(a["offer"].get("delivery_cost_per_unit", 0) or 0))
                       for a in lst) <= float(budget) + ov)
        obj.SetCoefficient(ov, P["budget_overrun_multiplier"])
    obj.SetMinimization()
    solver.SetTimeLimit(int(P["time_limit_s"] * 1000))
    status = solver.Solve()
    status_name = {pywraplp.Solver.OPTIMAL: "OPTIMAL", pywraplp.Solver.FEASIBLE: "FEASIBLE",
                   pywraplp.Solver.INFEASIBLE: "INFEASIBLE", pywraplp.Solver.NOT_SOLVED: "NOT_SOLVED"
                   }.get(status, str(status))
    if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        return {"status": status_name, "awards": [], "draft_pos": [], "unmet": [],
                "warnings": ["Solver found no solution"], "summary": {}}

    # ---- extract -----------------------------------------------------------
    awards = []
    for a in alts:
        q = a["x"].solution_value()
        if q > 1e-6:
            r, o = a["line"], a["offer"]
            awards.append({
                "line_id": r["line_id"], "mr_id": r["mr_id"], "project_id": r["project_id"],
                "item": r["item"], "unit": r.get("unit") or o.get("unit"),
                "supplier_id": o["supplier_id"], "supplier": sup[o["supplier_id"]].get("name", o["supplier_id"]),
                "qty": round(q, 3), "unit_price": a["price"], "tier": a["tier"],
                "lead_days": int(o.get("lead_days", 0) or 0), "late_days": a["late"],
                "line_total": round(q * a["price"], 2),
                "delivery_cost": round(q * float(o.get("delivery_cost_per_unit", 0) or 0), 2),
            })
    unmet = [{"line_id": lid, "item": next(r["item"] for r in data["requirements"] if r["line_id"] == lid),
              "qty_unmet": round(v.solution_value(), 3)}
             for lid, v in shortage.items() if v.solution_value() > 1e-6]
    for um in unmet:
        warnings.append(f"Line {um['line_id']} ({um['item']}): {um['qty_unmet']} unmet — no feasible offer")
    for a_ in awards:
        if a_["late_days"] > 0:
            warnings.append(f"Line {a_['line_id']} from {a_['supplier']} arrives {a_['late_days']}d after required date")
    for pid, ov in over.items():
        if ov.solution_value() > 1e-6:
            warnings.append(f"Project {pid} exceeds budget by {ov.solution_value():,.0f}")

    pos = defaultdict(list)
    for a_ in awards:
        pos[(a_["mr_id"], a_["supplier_id"])].append(a_)
    draft_pos = []
    for (mr, sid), lines in sorted(pos.items()):
        sub = round(sum(l["line_total"] + l["delivery_cost"] for l in lines), 2)
        vat = round(sub * P["vat_rate"], 2)
        lead = max(l["lead_days"] for l in lines)
        draft_pos.append({"mr_id": mr, "supplier_id": sid, "supplier": lines[0]["supplier"],
                          "project_id": lines[0]["project_id"],
                          "order_date": as_of.isoformat(),
                          "delivery_date": (as_of + timedelta(days=lead)).isoformat(),
                          "subtotal": sub, "vat": vat, "total": round(sub + vat, 2), "lines": lines})

    spend = sum(l["line_total"] + l["delivery_cost"] for l in awards)
    est = sum(float(r.get("est_unit_price") or 0) * r["qty"] for r in data["requirements"])
    baseline = _naive_baseline(data, offers_by_item, as_of)
    summary = {
        "objective": round(solver.Objective().Value(), 2),
        "total_spend_ex_vat": round(spend, 2),
        "estimated_budget": round(est, 2),
        "saving_vs_estimate": round(est - spend, 2) if est else None,
        "lower_bound_spend": baseline,
        "premium_over_lower_bound": round(spend - baseline, 2) if baseline else None,
        "suppliers_used": len({a_["supplier_id"] for a_ in awards}),
        "pos": len(draft_pos),
        "late_lines": sum(1 for a_ in awards if a_["late_days"] > 0),
        "unmet_lines": len(unmet),
        "mip_gap_note": "optimal" if status == pywraplp.Solver.OPTIMAL else "time-limited feasible",
        "solve_time_ms": solver.wall_time(),
    }
    return {"status": status_name, "summary": summary, "awards": awards,
            "draft_pos": draft_pos, "unmet": unmet, "warnings": warnings}


def _naive_baseline(data, offers_by_item, as_of) -> float:
    """Theoretical lower bound: cheapest list price per line, ignoring capacity,
    lateness, supplier count and order minimums. NOT a realistic buyer baseline —
    the gap is the price of satisfying real-world constraints."""
    total = 0.0
    for r in data["requirements"]:
        best = None
        for o in offers_by_item.get(r["item"], []):
            t = _tiers(o)
            if not t:
                continue
            q = r["qty"]
            price = None
            for lo, hi, p in t:
                if lo <= q <= hi or (hi == float("inf") and q >= lo):
                    price = p
            if price is None:
                price = t[0][2]
            cost = q * price + q * float(o.get("delivery_cost_per_unit", 0) or 0)
            if best is None or cost < best:
                best = cost
        if best is not None:
            total += best
    return round(total, 2)
