"""Synthetic demo data (ILLUSTRATIVE prices only — not market quotes)."""
import random


def make_demo(seed: int = 7) -> dict:
    rnd = random.Random(seed)
    items = {  # item: (unit, base_price EGP)
        "حديد تسليح 16مم": ("طن", 38000), "أسمنت": ("طن", 3200), "رمل": ("م3", 280),
        "زلط": ("م3", 420), "طوب أحمر": ("ألف", 3800), "كابل نحاس 3x2.5": ("متر", 55),
        "ماسورة PVC 4 بوصة": ("متر", 70), "دهان بلاستيك": ("لتر", 95),
    }
    suppliers = [
        {"id": f"S{i}", "name": n, "avl_status": st, "rating": rt, "status": "Active"}
        for i, (n, st, rt) in enumerate([
            ("المتحدة للحديد", "Approved", 4.5), ("النيل للتوريدات", "Approved", 4.0),
            ("الدلتا للخامات", "Approved", 3.2), ("الصعيد للمواد", "Conditional", 3.8),
            ("الشروق للكهرباء", "Approved", 4.7), ("المقاولون العرب للدهانات", "Approved", 4.1),
            ("مورد غير معتمد", "Rejected", 2.0)], 1)]
    suppliers[0]["min_order_value"] = 100000
    offers = []
    for item, (unit, base) in items.items():
        for s in suppliers:
            if rnd.random() < 0.35:
                continue
            f = rnd.uniform(0.93, 1.08)
            offers.append({
                "supplier_id": s["id"], "item": item, "unit": unit,
                "tiers": [{"min_qty": 0, "unit_price": round(base * f, 2)},
                          {"min_qty": 50 if base > 1000 else 500, "unit_price": round(base * f * 0.96, 2)}],
                "moq": rnd.choice([0, 0, 5]) if base > 1000 else 0,
                "capacity": round(rnd.uniform(0.8, 3.0) * (120 if base > 1000 else 2000)),
                "lead_days": rnd.choice([2, 4, 7, 10, 14]),
                "payment_days": rnd.choice([0, 15, 30, 60]),
                "delivery_cost_per_unit": round(base * rnd.uniform(0.005, 0.02), 2),
            })
    reqs, n = [], 0
    for mr, proj, due in [("MR-001", "P-NewCairo", "2026-12-01"), ("MR-002", "P-Alex", "2026-11-28"),
                          ("MR-003", "P-NewCairo", "2026-12-20")]:
        for item, (unit, base) in rnd.sample(list(items.items()), 5):
            n += 1
            q = round(rnd.uniform(20, 150) if base > 1000 else rnd.uniform(300, 1500), 1)
            reqs.append({"line_id": f"L{n:03d}", "mr_id": mr, "project_id": proj, "item": item,
                         "unit": unit, "qty": q, "required_date": due,
                         "priority": rnd.choice(["Normal", "High", "Urgent"]),
                         "est_unit_price": round(base * 1.05, 2)})
    return {"as_of": "2026-11-20", "params": {"max_suppliers_per_mr": 3},
            "suppliers": suppliers, "requirements": reqs, "offers": offers,
            "budgets": {"P-Alex": 2_500_000}}
