# United Brothers Co. — Operations PWA

A production-grade, **zero-subscription** internal operations Progressive Web App for a
general contracting firm running 4–5 concurrent projects (~25 users).

**Architecture (100% Google Workspace free tier):**

| Layer | Technology |
|------|-----------|
| Database | Google Sheets (relational ledger, UUID keys across tabs) |
| Backend API | Google Apps Script Web App (`doGet`/`doPost`, JSON REST) |
| File storage | Google Drive (programmatic per-project folder trees + images) |
| Deploy (backend) | `@google/clasp` from this workspace terminal |
| Frontend | Vanilla HTML5/JS PWA (offline-first), hosted free on Firebase / GitHub Pages / Vercel |

No frameworks, no build dependencies, no monthly fees.

---

## Repository layout

```
ubc-ops-pwa/
├── backend/                 # Google Apps Script project (push with clasp)
│   ├── Config.gs            # SCHEMA — the relational ledger definition
│   ├── Utils.gs             # errors, JSON envelopes, UUID, validation
│   ├── Database.gs          # CRUD + LockService + idempotency + FK checks
│   ├── DriveService.gs      # folder provisioning + chunked uploads
│   ├── Projects.gs          # project create -> Drive tree -> write-back URLs
│   ├── Departments.gs       # Procurement / Technical / Accounting / Warehouse
│   ├── Code.gs              # doGet/doPost router + sync.push batch
│   ├── Setup.gs             # initializeWorkbook(), seedDemoData()
│   ├── Tests.gs             # runAllTests() — in-editor test suite
│   ├── appsscript.json      # manifest (scopes, web app config)
│   └── .clasp.json.example  # copy to .clasp.json and add your scriptId
├── frontend/                # the PWA (deploy dist/ after build)
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── service-worker.js
│   ├── css/styles.css
│   └── js/ {config,db,api,image,sync,ui,app}.js
├── scripts/ {build,make-icons,check-syntax,serve}.mjs
├── firebase.json · vercel.json · .github/workflows/deploy-pages.yml
└── package.json
```

---

## Part 1 — Backend (Apps Script + Sheets + Drive)

### Option A: deploy from this terminal with clasp (recommended)

> Requires Node.js 18+. Install once: `winget install OpenJS.NodeJS.LTS`
> (then reopen the terminal so `node`/`npm` are on PATH).

```bash
npm install                 # installs @google/clasp locally
npx clasp login             # opens browser; authorize with the UBC Google account
```

Create the Apps Script project bound to a **new spreadsheet**:

```bash
cd backend
npx clasp create --type sheets --title "UBC Operations API"
#  -> writes .clasp.json with scriptId, and creates the bound Sheet
npx clasp push              # uploads all .gs + appsscript.json
npx clasp open              # opens the editor
```

In the Apps Script editor:
1. Run **`initializeWorkbook`** once → creates every tab, the Drive root folder,
   and generates an `API_TOKEN` (printed in the Execution log). Copy it.
2. (Optional) Run **`seedDemoData`** to create a sample project + Drive tree.
3. (Optional) Run **`runAllTests`** to validate the data layer end-to-end.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (token still gates writes)
   - Copy the **/exec URL**.

### Option B: manual (no terminal)
Create a new Google Sheet → Extensions → Apps Script → paste each `.gs` file →
set `appsscript.json` (enable "Show manifest") → run `initializeWorkbook` → deploy as Web App.

### Backend security model
- Every **write** action requires `token` === Script Property `API_TOKEN`.
- Every **mutation** runs inside `LockService.getScriptLock()` with a **15s** window,
  preventing row-write collisions from concurrent users.
- **Idempotency:** each record carries `client_uuid`; re-syncing the same offline
  capture returns the existing row instead of duplicating.
- **Foreign keys** are validated on insert/update (e.g. an expense must point to a real project).

---

## Part 2 — Frontend (PWA)

### Local test
```bash
node scripts/make-icons.mjs   # generates PNG icons (192/512)
node scripts/serve.mjs        # http://localhost:5173
```
Open the site → **Settings** → paste the Web App **/exec URL**, the **API token**,
and your name → **Ping Backend** to confirm connectivity.

### Build + deploy a static bundle
```bash
node scripts/build.mjs        # outputs dist/
```
Then pick one host:

**Firebase Hosting**
```bash
npm i -g firebase-tools
firebase login
firebase init hosting   # public dir: dist  (already configured in firebase.json)
firebase deploy --only hosting
```

**GitHub Pages** — push to `main`; the included Action builds and deploys automatically.

**Vercel** — `vercel` (uses `vercel.json`; build command + output dir preconfigured).

---

## Capabilities implemented (per blueprint)

1. **Automated project directory provisioning.** Creating a project programmatically
   builds `[Project Name]_[UUID]/` with the five mandated sub-folders and writes every
   folder URL back to the master sheet.
2. **Heavy-duty media uploads.** Client compresses images to ≤1200px JPEG; files >2MB
   stream via a chunked `begin/chunk/finish` protocol that bypasses Apps Script payload
   and execution limits.
3. **Offline-first queue & concurrency.** Captures persist to **IndexedDB** with
   `sync_status:"pending"` + timestamp; on reconnect they drain in sequential batches;
   the backend serializes writes with a 15s **LockService** window.
4. **Core departmental data models.** Procurement (Requisitions, POs, Price Tracker),
   Technical Office (Progress Logs, Takeoffs, Milestones), Accounting (Expenses,
   Subcontractor Payments, Receipts), Warehouse (MTRs, GRNs, Stock + minimum alerts).

---

## REST API quick reference

`POST {API_BASE}` with a JSON body `{ "action": "...", "token": "...", ... }`.

| Action | Purpose |
|--------|---------|
| `ping` / `schema` | health / schema introspection |
| `project.create` | create project + Drive tree |
| `procurement.requisition` / `procurement.po` / `procurement.price` | procurement |
| `tech.progress` / `tech.takeoff` / `tech.milestone` | technical office |
| `acc.expense` / `acc.subpayment` / `acc.receipt` | accounting |
| `wh.mtr` / `wh.grn` / `wh.stock` / `wh.lowstock` | warehouse |
| `file.uploadToProject` | upload to a project sub-folder by slot |
| `upload.begin` / `upload.chunk` / `upload.finish` | large file chunking |
| `sync.push` | batch ingest of offline ops |
| `create` / `update` / `delete` / `list` / `get` | generic CRUD over any entity |

Responses use the envelope `{ ok, ts, data | error }`.

---

## Verifying syntax in this workspace
```bash
node scripts/check-syntax.mjs   # parses every .gs/.js file, reports errors
```
(Requires Node.js. The `.gs` files are V8 JavaScript and parse with the same engine.)
