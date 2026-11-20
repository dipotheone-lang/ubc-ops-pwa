import copy
import pytest
from ubc_solver import optimize_procurement
from ubc_solver.procurement import InputError
from ubc_solver.demo_data import make_demo


def base(**kw):
    d = {
        "as_of": "2026-11-20",
        "params": {"fixed_order_cost": 0, "rating_risk_pct": 0, "financing_rate": 0,
                   "late_penalty_pct_per_day": 0},
        "suppliers": [{"id": "A", "name": "A", "avl_status": "Approved", "rating": 5},
                      {"id": "B", "name": "B", "avl_status": "Approved", "rating": 5}],
        "requirements": [{"line_id": "L1", "mr_id": "M1", "project_id": "P", "item": "steel",
                          "unit": "t", "qty": 100, "required_date": "2026-12-20"}],
        "offers": [
            {"supplier_id": "A", "item": "steel", "tiers": [{"min_qty": 0, "unit_price": 100}], "lead_days": 5},
            {"supplier_id": "B", "item": "steel", "tiers": [{"min_qty": 0, "unit_price": 110}], "lead_days": 5},
        ],
    }
    d.update(kw)
    return d


def total_qty(res, line="L1"):
    return sum(a["qty"] for a in res["awards"] if a["line_id"] == line)


def test_cheapest_wins():
    r = optimize_procurement(base())
    assert r["status"] == "OPTIMAL"
    assert {a["supplier_id"] for a in r["awards"]} == {"A"}
    assert r["summary"]["total_spend_ex_vat"] == 10000


def test_capacity_forces_split():
    d = base()
    d["offers"][0]["capacity"] = 60
    r = optimize_procurement(d)
    by = {a["supplier_id"]: a["qty"] for a in r["awards"]}
    assert by["A"] == pytest.approx(60) and by["B"] == pytest.approx(40)
    assert r["unmet"] == []


def test_capacity_shared_across_lines():
    d = base()
    d["requirements"].append({"line_id": "L2", "mr_id": "M2", "project_id": "P", "item": "steel",
                              "unit": "t", "qty": 100, "required_date": "2026-12-20"})
    d["offers"][0]["capacity"] = 120
    r = optimize_procurement(d)
    a_total = sum(a["qty"] for a in r["awards"] if a["supplier_id"] == "A")
    assert a_total <= 120 + 1e-6
    assert total_qty(r, "L1") + total_qty(r, "L2") == pytest.approx(200)


def test_unapproved_supplier_excluded():
    d = base()
    d["suppliers"][0]["avl_status"] = "Rejected"
    r = optimize_procurement(d)
    assert {a["supplier_id"] for a in r["awards"]} == {"B"}


def test_conditional_only_if_allowed():
    d = base()
    d["suppliers"][0]["avl_status"] = "Conditional"
    assert {a["supplier_id"] for a in optimize_procurement(d)["awards"]} == {"B"}
    d["params"]["allow_conditional"] = True
    assert {a["supplier_id"] for a in optimize_procurement(d)["awards"]} == {"A"}


def test_lateness_steers_to_faster_supplier():
    d = base()
    d["params"]["late_penalty_pct_per_day"] = 5
    d["requirements"][0]["required_date"] = "2026-11-25"   # 5 days
    d["requirements"][0]["priority"] = "Urgent"
    d["offers"][0]["lead_days"] = 20                          # A is cheap but late
    r = optimize_procurement(d)
    assert {a["supplier_id"] for a in r["awards"]} == {"B"}
    assert r["summary"]["late_lines"] == 0


def test_max_late_days_excludes_offer():
    d = base()
    d["params"]["max_late_days"] = 0
    d["requirements"][0]["required_date"] = "2026-11-22"
    d["offers"][0]["lead_days"] = 10
    d["offers"][1]["lead_days"] = 2
    r = optimize_procurement(d)
    assert {a["supplier_id"] for a in r["awards"]} == {"B"}


def test_volume_tier_discount_is_used():
    d = base()
    d["offers"][1]["tiers"] = [{"min_qty": 0, "unit_price": 110}, {"min_qty": 100, "unit_price": 90}]
    r = optimize_procurement(d)
    assert {a["supplier_id"] for a in r["awards"]} == {"B"}
    assert r["awards"][0]["unit_price"] == 90 and r["awards"][0]["tier"] == 1


def test_moq_respected():
    d = base()
    d["requirements"][0]["qty"] = 10
    d["offers"][0]["moq"] = 50     # A cannot supply 10 -> B
    r = optimize_procurement(d)
    assert {a["supplier_id"] for a in r["awards"]} == {"B"}


def test_max_suppliers_per_mr():
    d = base()
    d["params"]["max_suppliers_per_mr"] = 1
    d["offers"][0]["capacity"] = 60
    d["offers"][1]["capacity"] = 60
    r = optimize_procurement(d)       # 100 needed, one supplier can give 60 -> 40 unmet
    assert len({a["supplier_id"] for a in r["awards"]}) == 1
    assert r["unmet"][0]["qty_unmet"] == pytest.approx(40)


def test_fixed_cost_consolidates_orders():
    d = base()
    d["params"]["fixed_order_cost"] = 5000
    d["requirements"].append({"line_id": "L2", "mr_id": "M1", "project_id": "P", "item": "cement",
                              "unit": "t", "qty": 10, "required_date": "2026-12-20"})
    d["offers"] += [
        {"supplier_id": "A", "item": "cement", "tiers": [{"min_qty": 0, "unit_price": 100}], "lead_days": 5},
        {"supplier_id": "B", "item": "cement", "tiers": [{"min_qty": 0, "unit_price": 95}], "lead_days": 5},
    ]
    r = optimize_procurement(d)
    assert {a["supplier_id"] for a in r["awards"]} == {"A"}   # one PO beats saving 50 EGP


def test_no_offer_reports_shortage():
    d = base()
    d["requirements"][0]["item"] = "unobtainium"
    r = optimize_procurement(d)
    assert r["unmet"][0]["qty_unmet"] == 100 and r["awards"] == []


def test_budget_overrun_warned():
    d = base()
    d["budgets"] = {"P": 5000}
    r = optimize_procurement(d)
    assert any("exceeds budget" in w for w in r["warnings"])


def test_po_totals_include_vat():
    r = optimize_procurement(base())
    po = r["draft_pos"][0]
    assert po["vat"] == pytest.approx(po["subtotal"] * 0.14, abs=0.01)


def test_validation():
    d = base(); del d["as_of"]
    with pytest.raises(InputError):
        optimize_procurement(d)
    d = base(); d["requirements"][0]["qty"] = 0
    with pytest.raises(InputError):
        optimize_procurement(d)


def test_demo_runs_covers_all_demand():
    r = optimize_procurement(make_demo())
    assert r["status"] in ("OPTIMAL", "FEASIBLE")
    cover = {}
    for a in r["awards"]:
        cover[a["line_id"]] = cover.get(a["line_id"], 0) + a["qty"]
    for u in r["unmet"]:
        cover[u["line_id"]] = cover.get(u["line_id"], 0) + u["qty_unmet"]
    for req in make_demo()["requirements"]:
        assert cover.get(req["line_id"], 0) == pytest.approx(req["qty"], abs=1e-3)
    assert all(a["supplier_id"] != "S7" for a in r["awards"])   # rejected supplier
