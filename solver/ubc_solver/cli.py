"""CLI:  python -m ubc_solver.cli solve input.json [-o out.json]
        python -m ubc_solver.cli demo  [-o examples/demo_input.json]"""
import argparse
import json
import sys

from .procurement import load_input, optimize_procurement
from .demo_data import make_demo


def _print_report(res: dict) -> None:
    s = res["summary"]
    print(f"Status: {res['status']}")
    if not s:
        print("\n".join(res["warnings"]))
        return
    print(f"Spend (ex VAT): {s['total_spend_ex_vat']:,.0f}   estimate: {s['estimated_budget']:,.0f}   "
          f"saving vs estimate: {s['saving_vs_estimate']:,.0f}")
    print(f"Unconstrained lower bound: {s['lower_bound_spend']:,.0f}   "
          f"premium paid for real-world constraints: {s['premium_over_lower_bound']:,.0f}")
    print(f"POs: {s['pos']}  suppliers: {s['suppliers_used']}  late lines: {s['late_lines']}  "
          f"unmet: {s['unmet_lines']}  solve: {s['solve_time_ms']} ms ({s['mip_gap_note']})")
    for po in res["draft_pos"]:
        print(f"\n  {po['mr_id']} -> {po['supplier']}  delivery {po['delivery_date']}  total {po['total']:,.0f}")
        for l in po["lines"]:
            print(f"     {l['item']:<22} {l['qty']:>9,.1f} {l['unit'] or '':<5} @ {l['unit_price']:>9,.2f}"
                  f"  late {l['late_days']}d")
    for w in res["warnings"]:
        print("WARNING:", w)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="ubc_solver")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("solve"); s.add_argument("input"); s.add_argument("-o", "--output")
    d = sub.add_parser("demo"); d.add_argument("-o", "--output"); d.add_argument("--solve", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "demo":
        data = make_demo()
        if a.output:
            json.dump(data, open(a.output, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            print("wrote", a.output)
        if a.solve or not a.output:
            _print_report(optimize_procurement(data))
        return 0
    res = optimize_procurement(load_input(a.input))
    if a.output:
        json.dump(res, open(a.output, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    _print_report(res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
