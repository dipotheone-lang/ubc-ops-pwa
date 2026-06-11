# United Brothers Co. — Integrated Operations Platform
## Consolidated Design Blueprint (v2 — full company rebuild)

> Derived from analysis of all 9 UBC departmental manuals, their forms packs, and
> workbooks (109 source files). This document is the single source of truth for the
> restructured application. Department extracts live in `../../ubc-analysis/dept/`.

---

## 0. What changes vs. the v1 app

The v1 PWA covered 4 workflows with a single shared token and no per-user identity.
UBC's manuals describe a **9-department operating system** governed by a **quantified
Delegation of Authority (DoA)**, multi-step approvals, document-controlled forms, and
KPI dashboards. v2 adds the three things v1 lacked:

1. **Identity** — unique per-user login (email + password; SSO-ready later).
2. **Authorization** — role-based access control (RBAC) + the DoA approval engine.
3. **Coverage** — all departments, their forms, registers, approvals, and reports.

The free-tier stack (Google **Sheets** ledger + Apps Script **REST API** + **Drive**
storage + static **PWA**) is retained — it is a stated client guardrail. Where the
stack strains (concurrency, reporting volume), mitigations are noted in §7.

---

## 1. Company operating model

**Company:** United Brothers Co. for Contracting, Supplies & Industrial Services
(UBCSIS), Suez, Egypt. ~25 staff, 4–5 concurrent projects, ~40M EGP/yr, target 100M.
Sectors: chemicals, energy, sugar, mining, glass, gypsum, cement, construction.

**Named executives (consistent across all manuals):**
| Role | Person | System role code |
|---|---|---|
| CEO | Ahmed Sadiek | `CEO` |
| COO | Ghareeb Mahmoud | `COO` |
| CFO | Ahmed Hassan | `CFO` |
| Construction Manager | Mahmoud Younes | `CONSTRUCTION_MGR` |
| Head of Proposals & Tendering | Donia Ali | `PTS_HEAD` |

**Department heads / functional roles:** `TPM_HEAD` (Technical Office Mgr),
`PROCUREMENT_MGR`, `HSE_MGR`, `HR_MGR`, `QAQC_MGR`, `BD_MGR`, `ASSET_LEAD`
(interim = Construction Mgr), `FINANCE_CONTROLLER`.

**Project-level roles:** `PROJECT_MGR`, `SITE_ENGINEER`, `SITE_SUPERVISOR`,
`FOREMAN`, `QS` (Quantity Surveyor), `QAQC_ENGINEER`, `HSE_OFFICER`,
`PLANNING_ENGINEER`, `TECH_OFFICE_ENGINEER`, `STOREKEEPER`, `SITE_ADMIN`,
`SURVEYOR`, `DOC_CONTROLLER`, `OPERATOR`, `ESTIMATOR`, `CONTRACTS_ENGINEER`,
`TENDER_COORDINATOR`, `ACCOUNTANT`, `PETTY_CASH_CUSTODIAN`, `EMPLOYEE`.

**HR grade ladder (drives several authorities):** G1–G2 unskilled, G3–G4 skilled,
G5 junior eng/QS, G6 engineer/QS/inspector, G7 senior eng/coordinator,
G8 PM/lead, G9 dept head/Construction Mgr, G10 senior dept head (CEO discretion),
G11 executive (shareholder approval). Contract countersign: HR Mgr ≤G7, CEO ≥G8.

**Governance principles (universal):** single source of truth; no
action without a numbered document; segregation of duties (raiser ≠ approver,
maker ≠ checker, issuer ≠ consumer); every transaction carries a **project code**;
exceptions logged at-or-above the authority they bypass; controlled-document
revision control.

---

## 2. System role catalog & access model

RBAC = **roles** (above) × **permissions** on **(module, entity, action)**, scoped by
**assignment** (global vs project-level). A user has one or more role assignments;
project roles are scoped to specific projects.

**Action verbs:** `view`, `create`, `edit`, `submit`, `approve`, `reject`, `sign`,
`close`, `void`, `export`, `admin`.

**Scope:** `GLOBAL` (e.g. CFO sees all) | `PROJECT` (e.g. a PM only their projects) |
`OWN` (e.g. an employee only their own leave/timesheets).

**Examples**
- `SITE_ENGINEER` → procurement.material_requisition: create/submit (PROJECT); cannot approve.
- `CFO` → finance.payment: approve up to limit (GLOBAL); finance.* view (GLOBAL).
- `EMPLOYEE` → hr.leave_request: create/submit (OWN); hr.* otherwise none.

Permissions are **data-driven** (a `Permissions` sheet + `Roles` sheet), so the matrix
can be tuned without code changes — the manuals themselves flag the DoA as
"adjusted centrally."

---

## 3. Master Authorization Matrix (the Delegation of Authority)

All limits **EGP, per transaction**, ex-VAT. This consolidates every quantified gate
found across the manuals. The standalone Governance "DoA schedule" referenced by the
Asset manual is **not in the source set** — these bands are reconstructed from the
operating manuals and must be ratified by the CEO/CFO (see §8 open items).

### 3.1 Procurement (spend commitment)
| Band (EGP) | Approvers | Sourcing rule |
|---|---|---|
| ≤ 25,000 | Site Engineer + Construction Mgr | 1 quote w/ note |
| 25,001–100,000 | Construction Mgr + Procurement Mgr | ≥3 quotes + CBA |
| 100,001–500,000 | + CFO co-sign | ≥3 quotes + CBA |
| 500,001–2,000,000 | + CEO co-sign | 3 quotes + CBA + CEO brief |
| > 2,000,000 | CEO + Board/Partners | full tender |

> ✅ Resolved (CFO, 2026-06): **these Finance-manual bands are canonical.** The
> Procurement manual's alternative table (PR: PM ≤250K / COO 250K–1M / CEO >1M; PO:
> PM ≤1M / COO 1M–5M / CEO >5M) is superseded for the approval engine. Retained here
> only for reference.

### 3.2 Payments (Finance)
| Instrument & band | Signatures |
|---|---|
| Petty cash ≤ 2,000 (HQ) / ≤ 5,000 (site) | Custodian / Site Engineer |
| Cheque ≤ 250,000 | two of (CEO/COO/CFO) |
| Cheque 250,001–1,000,000 | two of three, one = CEO or CFO |
| Cheque > 1,000,000 | CEO + CFO |
| Transfer ≤ 250,000 | Maker (Finance) + Checker (CFO) |
| Transfer > 250,000 | Maker + (CEO or CFO) |

### 3.3 Revenue / customer-facing (Finance)
E-invoice ≤500K → CFO; >500K → CEO+CFO. Credit note → CFO; >500K → +CEO.
Variation acceptance → CM+Tendering+CFO. Receivables write-off → CEO+CFO+legal.
Retention release → CM (DLP) + CFO.

### 3.4 Capital / treasury (Finance)
Capitalization → CFO; >1M → +CEO. Disposal → CEO+CFO. Depreciation-life change →
CEO+CFO+auditor. BG/cash margin → CFO; margin >500K → +CEO. Facility drawdown →
CEO+CFO. Manual journal → CFO; >100K single entry → +CEO.

### 3.5 Technical Office / Projects
| Item | Band | Authority |
|---|---|---|
| Variation Order (VOR) | ≤250K | Project Mgr |
| | 250K–1M | TPM Head |
| | 1M–5M | COO |
| | >5M | CEO (+CFO concurrence) |
| IPC (interim payment cert) | ≤10% contract value | PM signs |
| | >10% contract value | + TPM Head |
| NCR disposition | Minor | QA/QC Engineer |
| | Major | PM + QA/QC Mgr |
| | Critical | Client + PM + QA/QC Mgr |
| Final Account | ≤5M | PM + TPM Head |
| | >5M | COO + CFO |
| Exception/waiver | minor / ≤1% / >1% / critical | PM / TPM Head / COO+CFO / CEO |
| Charter sign | — | PM + TPM Head + COO |
| Baseline schedule | — | Planning→PM→TPM Head→COO |

### 3.6 Construction site
Mobilisation start → Construction Mgr. Subcontract award (in budget) → CM+COO.
Site VO >100K → CM+CFO; >500K → CEO. Site petty cash >5K/item → PM.
Equipment hire >50K/month → CM. Stop-work → any of Site Sup/HSE/PM (absolute).

### 3.7 Proposals / Tendering (PTS) — bands ≤1M / 1M–25M / >25M
Go/No-Go → PTS Head / +COO / CEO. Sign & submit → PTS Head / +CFO / CEO.
Margin <8% → PTS Head / CFO+PTS Head / CEO+CFO. **Sign main contract with client →
CEO only (all bands)** — only the CEO legally binds UBCSIS. Bid review (F-07)
mandatory >1M; Legal mandatory for public bids & ≥5M; CEO mandatory ≥25M.

### 3.8 HR
Hire <dept-head → HR Mgr (+COO/CFO); dept-head+ → CEO. Salary increase (cycle) →
CEO+CFO; off-cycle → CEO. Promotion → COO+CEO. Termination (probation) → HR Mgr;
(post) → CEO+Legal. Written warning → HR Mgr; suspension/dismissal → CEO+Legal.
Training >25K → COO+CFO. Out-of-policy leave → HR Mgr (+COO). Leave (standard) →
Line Manager. Final settlement → CFO authorises.

### 3.9 HSE
Stop-work → Site Sup/HSE Officer (absolute, CEO-derived, non-overridable).
Residual risk: Extreme(20–25) → CEO; High(12–16) → COO; Med-High(8–12) → HSE Mgr;
Medium → PM. PTW issuance → Authoriser (PM/HSE Officer). New-site mobilisation →
HSE Mgr+COO. Investigation team scales by severity (FAC→Officer … Fatality→HSE
Mgr+COO+external+Legal).

### 3.10 Asset & Equipment
No monetary bands in the manual — **all deferred to the corporate DoA** (use the
matching bands from §3.1/3.4). Hard gates: lapsed cert / out-of-cal / non-compliant
vehicle = prohibited use (no approval can override).

---

## 4. Module map (9 domains)

Each module = entities (sheets) + workflows + approvals (from §3) + registers + reports.

1. **Foundation / Admin** — Users, Roles, Permissions, Projects (master), Clients,
   Suppliers/AVL, Audit Log, Document-Number sequences, Settings/Lookups, Approvals
   (generic workflow), Attachments index.
2. **Business Development & Marketing** — Leads, Opportunity Pipeline (stage/gate),
   Qualification Scorecard, Capture Plans, Clients/Contacts CRM, Key Account Plans,
   Interaction Log, Prequalifications, Win/Loss, Retention. (forms F-BDM-01..18)
3. **Proposals, Sales & Tendering** — Tender Register, Go/No-Go (F-02), Cost Build-Up
   (F-03), RFQs, Bid Review & Sign-off (F-07), Submission, Clarifications,
   Negotiation, Contract Review (F-11), **Contract Setup Pack / Handover (F-12)**,
   Final Account (F-13), KPI dashboard (F-15), Pipeline (F-16). (SOP-PTS-001..010)
4. **Technical Office, Projects & Planning** — Project Charter (F-01), Material
   Submittals (F-02/MAS), RFIs (F-03), Method Statements (F-04), JSA (F-05), ITP
   (F-06), NCR (F-07), VOR (F-08), EOT (F-09), Subcontracts (F-10), IPC/Mostakhlas
   (F-11), Punch List (F-12), Close-Out (F-13); Baseline/EVM, trackers T-01..T-09,
   Exceptions & Change registers. (SOP-01..10)
5. **Construction & Site Operations** — Mobilisation (F-CSO-01/02), Daily Site Report
   (F-CSO-22) & Site Diary (F-CSO-25), Productivity (F-CSO-26), Cost Control (F-27),
   EV Dashboard (F-29), Subcontractor mgmt, Material receipt/issue (F-18/19), Temp
   works & lifting, Mechanical Completion/Punch/Clearance. (SOP-CSO-01..08)
6. **Procurement & Supply Chain** — PR (UBC-PR), RFQ, TBE/CBE bid eval + Award,
   PO (+amendments), Expediting, GRN/MRV (F-MRV), MIR, NCR, MIV (issue), MRT
   (return), IPT (transfer), Stock/Bin/Stock-take, Scrap, AVL, VEV, Item Library,
   Trackers/Reports. (10-stage lifecycle)
7. **Warehouse & Inventory** — (operational subset of §6) Stock items + min/max,
   GRN→stock, MIV→consumption, transfers, cycle/full counts, low-stock alerts.
8. **Finance & Accounting** — Journal (single-entry), COA, Project codes, PV/RV,
   Petty Cash, three-way match, e-invoicing/Mostakhlas tracker, WHT/Form 13, NOSI,
   Bank/Cheque sub-ledger, BG register, Fixed Asset Register, Month-end close
   (5-day), Profitability Dashboard, Cost-to-Complete. (SOP 3.1–3.4)
9. **HR & Administration** — Employee master + grades, Recruitment (F-HR-01..06),
   Onboarding/Probation, Payroll variation (F-HR-11), Leave (F-HR-15) & Timesheets
   (F-HR-14), Appraisals (F-HR-17..20), Training + bonds, Discipline/Grievance,
   Separation/EOSB (F-HR-28..31), document-expiry/cert tracking.
10. **Asset & Equipment** — Asset Register (F-AEM-03) + tags, Acquisition/Commissioning,
    Movement/Transfer, PM plans & work records, Pre-use inspection, Faults,
    Statutory certification register, Calibration register, Fleet & drivers, Fuel/
    running cost, Utilisation, Replacement, Disposal. (SOP-AEM-01..06)
11. **HSE (cross-cutting)** — HIRA/JSA, Permit-to-Work (8 types), Incident reporting
    & investigation, Inspections/audits, Training matrix, Environmental, Contractor
    HSE; LTIFR/TRIR dashboard. (SOP-HSE-01..10)

**Cross-department value chain (the golden thread):**
`BD opportunity → PTS tender → (award) Contract Setup Pack → TPM Project Charter →
Procurement PR/PO → Warehouse GRN/MIV → Construction execution + HSE permits →
TPM IPC/Mostakhlas → Finance e-invoice & payment → Close-out → Lessons Learned.`
Every step is project-coded and audit-logged; this chain is the spine of the app.

---

## 5. Approval-workflow engine (generic)

One engine serves every module. A **workflow definition** (data-driven, per
entity+action) lists ordered **steps**; each step resolves required approver(s) by
**role + DoA band** (value-dependent) and **scope** (project/global).

- `ApprovalRequests` sheet: id, entity, record_id, project_id, amount, initiator,
  current_step, status (Draft/Pending/Approved/Rejected/Returned), created_at.
- `ApprovalSteps` sheet: request_id, step_no, role_required, approver_user,
  decision, decision_at, comment, signature_hash.
- Value-band resolution: given (domain, amount), engine computes the required signer
  chain from §3 and instantiates the steps. Parallel ("two of three") and sequential
  chains both supported.
- **Segregation of duties** enforced: initiator cannot be an approver on the same
  request; maker ≠ checker validated server-side.
- Every decision is appended to the immutable **Audit Log** with the user's verified
  email (from SSO), timestamp, and before/after snapshot.

---

## 6. Authentication & identity (the core new capability)

**Decision (ratified): email + password accounts**, stored in the `Users` sheet.
(Google Workspace SSO remains a drop-in future option — the session/RBAC layer below
is identity-source-agnostic.)

**Credential storage (must be done right):**
- Never store plaintext. Each user row holds `salt` + `password_hash`.
- Apps Script has no bcrypt, so we use **PBKDF2-style stretching**: many thousands of
  iterations of salted `Utilities.computeHmacSha256Signature` (HMAC-SHA-256), per-user
  random 16-byte salt, configurable iteration count. Constant-time hash comparison.
- Password policy: min length, complexity, lockout after N failed attempts (tracked
  per user with a cooldown), forced reset on first login, admin reset flow.

**Session flow:**
1. PWA `POST login {email, password}` → backend verifies hash → issues a **session
   token** (random, hashed-at-rest in a `Sessions` sheet) with an expiry (e.g. 12h)
   and the user's `user_id`.
2. Client stores the session token (IndexedDB) and sends it on every request.
3. Backend validates the session (exists, not expired), loads the user's **roles +
   project assignments**, and checks every request against RBAC + DoA.
4. Logout / expiry invalidates the session row. Optional "remember device" extends TTL.

**Security notes & limits on this stack:** HTTPS is provided by Apps Script/Pages.
Apps Script can't set httpOnly cookies, so the session token lives in app storage —
acceptable for an internal tool, hardened by short TTL + server-side revocation +
audit logging. A pepper (server-side secret in Script Properties) is added to the
hash so a leaked Sheet alone can't be brute-forced offline. This replaces v1's single
shared token and is what makes per-user authorization, signatures, and the audit
trail meaningful.

---

## 7. Architecture on the free-tier stack (and its limits)

- **Data:** one Google Sheet workbook as relational ledger; ~50+ tabs across modules.
  Risk: Sheets has a 10M-cell ceiling and slows with very large tabs. Mitigation:
  archive closed-project transactional rows yearly; keep hot data lean; consider one
  workbook per domain if a single book grows large.
- **API:** Apps Script Web App, `doGet/doPost`, JWT-verified, RBAC+DoA enforced,
  `LockService` on writes (15s), document-number service, batch sync. Risk: 6-min
  execution + quota limits. Mitigation: keep handlers small, paginate reads, push
  heavy reporting to scheduled (time-driven) aggregation into a `Reports_Cache` tab.
- **Files:** Drive per-project folder trees (extend v1's 5 folders to the full set
  per module, e.g. HSE, HR-confidential with restricted sharing).
- **Frontend:** keep the offline-first vanilla PWA; grow it into a role-aware SPA
  whose navigation and forms render from the permission set the API returns.
- **Reporting/Dashboards:** server-side aggregation into cache tabs + client charts;
  optionally a read-only Looker Studio connected to the Sheet for exec dashboards
  (also free) — recommended for the heavy KPI dashboards in §3-derived reports.

---

## 8. Open items — RATIFIED by CFO (Ahmed Hassan), 2026-06

1. **Procurement authority bands** — ✅ **RESOLVED: use the Finance manual bands (§3.1)
   as canonical.** The Procurement-manual bands (§3.1 ⚠ note) are superseded for the
   approval engine.
2. **Chart of Accounts** — ✅ **RESOLVED: the manual's 7-digit Suez structure is
   canonical.** Finance module builds on it; we add a mapping table from the legacy
   `P-0xx` / 65-category live-workbook codes for migration/back-reference.
3. **Governance "Delegation of Authority" master** — ✅ **RESOLVED: the reconstructed
   matrix in §3 is ratified as canonical**, marked "pending formal Governance-doc
   issue," and fully editable in the admin UI (Roles/Permissions/DoA sheets) without
   code changes.
4. **Effective dates differ** — treat all manuals as active; future-dated roles (BD
   Mgr, Asset Lead, HSE Trainer, Recruitment/L&D Officers) modelled as vacant/interim.
5. **Forms field-level detail** — model the documented fields; attach original `.xlsx`
   where exactness matters.
6. **HR resignation-notice typo** — apply <10yr = 2mo, ≥10yr = 3mo.

---

## 9. Phased delivery plan

**Phase 1 — Foundation (the platform).** SSO login, Users/Roles/Permissions, RBAC
middleware, generic Approval engine, Audit Log, Document-number service, Projects/
Clients/Suppliers masters, role-aware PWA shell + admin screens. *Nothing else works
correctly without this.*

**Phase 2 — Core value chain.** Procurement (PR→PO→GRN→MIV) + Warehouse + Finance
(PV/RV, three-way match, payments) + Technical Office (Charter, VOR, IPC, NCR) —
fully wired through the Approval engine. This is the operational heart and the
hardest approval logic.

**Phase 3 — Site & commercial.** Construction (daily reports, productivity, site
diary), PTS (tender register → Go/No-Go → bid review → Contract Setup Pack), BD
(pipeline/CRM).

**Phase 4 — People, assets, safety.** HR (leave/timesheets/payroll inputs/appraisals),
Asset & Equipment (register, maintenance, calibration, fleet), HSE (permits,
incidents, inspections).

**Phase 5 — Reporting & dashboards.** Per-department KPI dashboards (§3-derived) +
exec consolidated dashboard + Looker Studio option; month-end & portfolio packs.

Each phase ships working software on the same deployment pipeline already built
(clasp push + GitHub Pages auto-deploy).

---

## 10. Reference platforms (alignment check)

The target pattern matches mid-market construction ERPs — **Procore** (project mgmt,
RFIs, submittals, daily logs), **Oracle Aconex** (doc control/transmittals),
**Autodesk Construction Cloud**, **Sage 300 CRE / Jobpac** (job costing, IPC),
**SAP/Oracle DoA** (delegation-of-authority approval chains), and CRM patterns from
**HubSpot/Salesforce** (pipeline/stages). UBC's manuals already encode these patterns
(submittal/RFI/NCR/VOR/IPC, DoA bands, pipeline gates); the app implements them on a
free stack rather than licensing those suites.

---

## 11. Operational-reality reconciliation (v3 — from the real document archive)

Analysis of UBC's *actual* operational files (folders 8–22 in `E:\UBCSIS Co Date
Jan 2026`, ~1,085 extracted docs; see `../../ubc-analysis/dept/op_*.md`) revealed the
manuals are largely **aspirational/target-state**, while day-to-day operation differs.
These findings **override the manual where they conflict**.

### 11.1 Material changes to earlier decisions
1. **Arabic-first / RTL is mandatory.** Every real Finance, HR, Warehouse, and
   correspondence artifact is Arabic. The PWA must be **bilingual AR/EN with full RTL**
   (English fallback for recruitment/specs). This is a top-level UI requirement.
2. **Chart of Accounts — reality is a *third* system.** Live "8. Finance" files use
   **NO numeric COA**: free-text **Arabic account names** (بنك قطر الوطنى، الخزينة
   الرئيسية، ايجارات، زكاه المال) with a de-facto cost-center key of **(Customer ×
   client PO)** e.g. `مشروع كناوف 301329`, `مشروع سيمنس 4093`. The manual's 7-digit COA,
   the blueprint's `P-0xx`, and the legacy `6xx-x` (Old Data) are three different
   schemes. **Re-decision needed** (see §11.4 Q1). Cash boxes are **Port Said / Cairo**
   (confirms the live-workbook flag), and treasury is **multi-currency (EGP/USD/EUR/GBP)**.
3. **Project key = client reference, not an internal code.** Real projects are keyed by
   **client PO / donor code** (GIZ `BEH-EDK-ISC`, `BEH-EDK-OMC`; PO `4510113022`; ENOVA
   `POC8878…`). The app's Project entity must accept an external client reference as the
   primary operational key (internal `UBC-PRJ-###` becomes a secondary id).
4. **HR grades G1–G11 do not exist** in any real record — employees carry only title +
   monthly wage + contract type. Grade-gated authorities (countersign ≤G7/≥G8, checks
   >G5) have no data basis. **Re-decision needed** (§11.4 Q3).
5. **Executive/owner identity discrepancy.** Manuals name CEO **Ahmed Sadiek** / CFO
   **Ahmed Hassan**; real legal/operational/legacy docs show the company run by GM
   **Ghareeb Mahmoud** with **Ahmed Diab** & **Mahmoud Diab** (owners/accountant) and
   procurement **Ahmed Hassan**, tenders **Donia Ali**. The DoA signatory names must be
   reconciled before seeding users/approval chains. **Re-decision needed** (§11.4 Q2).
   Company legal identity (constant everywhere): **UBcsis, CR 66236, TRN 545-821-037**,
   VAT 1193808382000, QNB Alahli Suez; founded 2017; ~8M EGP sales; ~15–25 staff.

### 11.2 New modules/features the real archive proves are needed
- **Official Correspondence (Arabic letters)** — generate letterhead docs: delegation
  (تفويض), payment-demand (مطالبة بمستحقات), receipt acknowledgement (إقرار استلام),
  sample submission. Recurring, templated, bilingual.
- **UBC-as-supplier prequalification profile** — UBC is constantly *registered by
  clients* (Air Liquide Hermes codes, Centamin, Savola, Saint-Gobain…). A reusable
  company-fact-sheet + project-track-record + document library that auto-fills client
  registration forms. Distinct from the inbound supplier **AVL**.
- **RCA / Preventative Action Plan** — `UB-RCA-YYYY-NNN-RV.NN`, investigation-team
  table, triggered by client deduction/violation events.
- **IPC/Mostakhlas generator** — exact real format: Item/Desc/Unit(M2/M3/M.L.)/Qty/
  U.price/Prev-Q/Current-Q/Total-Q/%/amounts, advance amortisation, retention, VAT,
  cumulative totals, tri-party sign-off, invoice `NNN/YYYY`. Civil **and** MEP/electrical
  BOQ discipline tabs.
- **Standing agreed-rate schedules per client** (e.g. GCE Civil Works Agreed Rates) that
  feed BOQ pricing.
- **HSE reality:** RA + Method Statement are an **inseparable pair keyed to a client
  PO/POC**; **PTW is issued by the client** (UBC records "PTW issued"); support client
  form codes (ENOVA `S3-F140/F141`). No live LTIFR/TRIR yet — build the register so it
  can start.
- **KPI module seeded with the 26 real KPIs** actually tracked (quarterly, target-only
  today, owned by named engineers: Operations, Procurement, Sales & Marketing,
  Technical Office) — add the missing actuals/RAG layer.
- **Warehouse** is Arabic free-text consumables (~130 items, no codes/min-max), siloed
  by project, with a **scrap-inbound (وارد الهالك)** column and recipient names. Map
  free-text → `CAT-SUB-NNN`, add units/min-max greenfield, keep project+recipient tags.

### 11.3 Migration sources (real legacy systems the app replaces)
- `UBcsis - Financial Accounts Program - Y2021.xlsm` (full Arabic accounting system),
  `2. UBcsis - Costing System.xlsb` (monthly cost ledgers — **binary, needs direct
  open; did not text-extract**), `UBCSIS Co YTD.xlsx` (Invoices Tracker from 001/2017
  with Tax-Deduction, **Cheque-Received Y/N**, **Form-13-Received Y/N**), `دليل حسابات`
  (legacy COA `6xx-x`), tool-custody `عهدة` registers, ATM/petty-cash, ENOVA vendor
  ledger. **Master data to seed:** ~29 clients (Galaxy=anchor since 2017, Siemens,
  Saint-Gobain, Canal Sugar, KNAUF, Suez Steel, Centamin, IFFCO, Lafarge…), real
  project list, supplier directories (ABB/Schneider/El Sewedy/IEC…), ~15–25 employees
  (codes `UB-001…UB-033`, **inconsistent — must normalise**), the 2026 HR master
  workbook as the HR target schema.
- **Document-control remediation:** the archive is full of uncontrolled `- Copy - Copy`
  duplicates and a pre-rebrand `CScis` letterhead — the single-source-of-truth +
  versioning requirement is validated.

### 11.4 New open items — RATIFIED by CFO, 2026-06
**Q1 — Chart of Accounts** → ✅ **HYBRID.** Structured go-forward 7-digit COA as the
reporting/audit backbone; **operational project/cost key = (Client × client-PO)** as
actually used; Arabic account names as display labels; mapping table from legacy
`6xx-x`/free-text for migration. (Supersedes §8 item 2's "pure 7-digit".)

**Q2 — Executive identity & DoA signatories** → ✅ **MANUAL ORG is canonical.** Seed
users/approval chains with: **Ahmed Sadiek (CEO), Ghareeb Mahmoud (COO), Ahmed Hassan
(CFO), Mahmoud Younes (Construction Mgr), Donia Ali (PTS Head)** + dept heads. Treat as
the go-forward org; real legacy signer names (Ahmed/Mahmoud Diab) map in as needed.

**Q3 — HR grades** → ✅ **OPTIONAL title→grade map.** Authority is driven by
**role + amount**; an optional title→grade mapping preserves grade-based rules
(e.g. insurance from G6) where wanted. No forced grading at migration.

### 11.5 Adopted as standing requirements (no longer open)
- **Bilingual AR/EN + full RTL** across the app (English fallback for recruitment/specs).
- **Multi-currency** treasury (EGP base; USD/EUR/GBP supported).
- **Project entity** accepts an external **client reference / PO** as primary operational
  key; internal `UBC-PRJ-###` is a secondary id.
- New modules in §11.2 (Arabic correspondence, UBC-as-supplier prequal profile, RCA,
  IPC/Mostakhlas generator, 26-KPI module) folded into the phase plan (§9): correspondence
  + prequal → Phase 3 (commercial); RCA → Phase 4 (HSE); IPC generator → Phase 2 (TPM);
  KPI module → Phase 5.
- **Migration** (§11.3 sources) becomes an explicit workstream in each phase.
