# United Brothers Co. — Operations PWA

A production-grade, **zero-subscription** internal operations Progressive Web App for a
general contracting firm (~25 users, 4–5 concurrent projects).

> **This repo contains two generations.** **v2/ is the current product** — per-user
> identity, RBAC, a Delegation-of-Authority approval engine, and ~12 departments.
> The top-level `backend/` + `frontend/` are the legacy **v1** (single shared token,
> 4 workflows); v1 is kept only for reference and is served at `/v1` on GitHub Pages.
> Everything below documents **v2** unless stated otherwise.

**Architecture (100% Google Workspace free tier):**

| Layer | Technology |
|------|-----------|
| Database | Google Sheets (relational ledger, ~45 tabs, UUID keys) |
| Backend API | Google Apps Script Web App (`doPost` JSON REST, session-token auth) |
| File storage | Google Drive (per-project folder trees + attachments) |
| Deploy (backend) | `@google/clasp` from this workspace terminal |
| Frontend | Vanilla HTML5/JS PWA (bilingual AR/EN, RTL), hosted free on Netlify / GitHub Pages / Vercel / Firebase |

No frameworks, no build dependencies, no monthly fees.

---

## Repository layout

```
ubc-ops-pwa/
├── v2/                          # ← the current product
│   ├── backend/                 # Google Apps Script project (push with clasp)
│   │   ├── Config.gs            # SCHEMA + role catalog + seed permission matrix + DoA bands
│   │   ├── Auth.gs              # email+password, salt+pepper hashing, sessions, lockout
│   │   ├── RBAC.gs              # role/permission resolution + enforcement
│   │   ├── Approvals.gs         # Delegation-of-Authority approval engine
│   │   ├── Database.gs          # header-mapped CRUD, LockService, FK + enum checks
│   │   ├── DriveService.gs      # project folder provisioning + uploads
│   │   ├── Operations*.gs       # domain services (procurement, warehouse, finance, …)
│   │   ├── Masters/Dashboard/Notifications/Audit/AdminExt/Migration.gs
│   │   ├── Code.gs              # doGet/doPost router + action dispatch
│   │   ├── Setup.gs            # initializeWorkbook() — idempotent seeding
│   │   ├── Tests.gs            # runAllTests() — in-editor test suite
│   │   └── appsscript.json
│   ├── frontend/                # the PWA (deploy dist/ after build)
│   │   ├── index.html · manifest.webmanifest · service-worker.js
│   │   ├── css/styles.css
│   │   └── js/ {api,app,ui,admin,dashboard,notifications,i18n}.js
│   ├── serve.mjs                # local static server (:5174)
│   └── test/ harness.mjs + migrate/seed/verify scripts
├── backend/ · frontend/         # legacy v1 (reference only)
├── scripts/ {build,make-icons,check-syntax,serve}.mjs
├── firebase.json · vercel.json · netlify.toml · .github/workflows/deploy-pages.yml
└── package.json
```

---

## Part 1 — Backend (Apps Script + Sheets + Drive)

> Requires Node.js 18+. Install `@google/clasp` locally: `npm install`.

```bash
npm run login                 # npx clasp login — authorize with the UBC Google account
cd v2/backend
npx clasp create --type sheets --title "UBC Operations API v2"
npm run push                  # (from repo root) → cd v2/backend && clasp push
npx clasp open
```

For a **standalone** script (not bound to the created Sheet), set Script Properties
`SPREADSHEET_ID` and `ROOT_FOLDER_ID`; otherwise the bound spreadsheet is used.

In the Apps Script editor:
1. Run **`initializeWorkbook`** once → creates every tab, seeds roles, the permission
   matrix, the DoA bands, lookups, and the seed users (including `admin@ubcsis.com`).
   A server-side `PEPPER` Script Property is generated on first password use.
2. **Deploy → New deployment → Web app** — Execute as **Me**, Who has access **Anyone**
   (all actions except `ping`/`auth.login`/`setup.claim` require a valid session). Copy
   the **/exec URL**.
3. **Claim the first admin password** (one-time; self-locks via `SETUP_CLAIMED`):
   ```bash
   curl -s "$EXEC" -H 'Content-Type: text/plain' \
     -d '{"action":"setup.claim","email":"admin@ubcsis.com","password":"<choose-a-strong-one>"}'
   ```
4. (Optional) Run **`runAllTests`** in the editor, or `npm test` locally (mocked-GAS harness).

### Backend security model (v2)
- **Identity:** email + password. Per-user random **salt** + server-side **pepper**
  (Script Property), stretched with 20 000 rounds of HMAC-SHA256; constant-time compare;
  uniform login error (password verified before any account-state is revealed) to prevent
  enumeration; lockout after 5 failures.
- **Sessions:** a random token is returned to the client; only its SHA-256 is stored.
  12 h TTL, server-side revocation. `last_seen` is updated lock-free; dead sessions are
  pruned on login (and via `admin.pruneSessions`).
- **RBAC:** roles carry `role_assignments` (GLOBAL or PROJECT scope). Permissions are
  `(role, module, entity, action, scope)` rows with `*` wildcards; OWN scope restricts
  reads to the caller's own records. Enforced on every action.
- **Delegation of Authority:** `submitDocument` routes a document through the approval
  engine by `(domain × amount)`; ordered signer chains enforce segregation of duties
  (an initiator can never approve their own request).
- **Data integrity:** every write runs under `LockService`; foreign keys and enums are
  validated; free-text is escaped against spreadsheet formula injection; stock issues are
  atomic and cannot go negative; document numbers never collide.
- **Audit:** every write is appended to an immutable audit log.

---

## Part 2 — Frontend (PWA)

### Local test
```bash
npm run icons                 # generates PNG icons (192/512)
npm run serve                 # v2 frontend on http://localhost:5174
```
On first load the sign-in screen asks for the Web App **/exec URL** (stored in
`localStorage` — the endpoint is never hardcoded), then your email + password.

### Build + deploy a static bundle
```bash
npm run build                 # copies v2/frontend → dist/  (verbatim, no minify)
```
Then pick one host — **all four publish v2**:

- **Netlify** — publishes `v2/frontend` directly (`netlify.toml`).
- **GitHub Pages** — push to `main`; the Action serves **v2 at root** and legacy **v1 at `/v1`**.
- **Vercel** — `vercel` (build command `node scripts/build.mjs` → `dist/` = v2).
- **Firebase** — `npm run deploy:firebase` (builds then deploys `dist/` = v2).

The service worker is **network-first** for the app shell and bypasses the API origin,
so a deploy is picked up on next load; bump the cache version in `service-worker.js`
when shipping offline-critical changes.

---

## REST API quick reference (v2)

`POST {/exec}` with a JSON body `{ "action": "...", "token": "<session>", ... }`
(`Content-Type: text/plain` to stay CORS-preflight-free). Responses use the envelope
`{ ok, ts, data | error }`.

| Action | Purpose |
|--------|---------|
| `ping` · `auth.login` · `setup.claim` | public: health · sign in · one-time admin claim |
| `auth.me` · `auth.logout` · `auth.changePassword` | session self-service |
| `bootstrap` | user + roles + permissions + lookups for the UI |
| `list` · `get` | generic reads (RBAC + OWN-scope filtered, secrets scrubbed) |
| `masters.*` · `admin.*` | clients/suppliers/projects · users/roles/permissions/audit |
| `procurement.*` · `wh.*` · `fin.*` · `tech.*` | MR/PO · GRN/MIV/stock · vouchers/expenses · charters/VOR/IPC/NCR |
| `bd.*` · `pts.*` · `con.*` · `corr.*` · `prequal.*` | BD · tendering · construction · correspondence · prequalification |
| `hr.*` · `asset.*` · `hse.*` | HR · assets · HSE (HIRA/permits/incidents) |
| `doc.detail` · `doc.update` · `doc.void` · `doc.submit` · `file.upload` | document lifecycle |
| `approvals.create` · `approvals.decide` · `approvals.pending` | Delegation-of-Authority workflow |
| `dashboard.summary` · `notifications.*` | role-aware dashboard · in-app notifications |

---

## Verifying in this workspace
```bash
npm run check                 # parses every .gs/.js/.mjs, reports errors
npm test                      # mocked-GAS harness (runAllTests + E2E) + offline-queue tests
```
Both run in **CI** (`.github/workflows/ci.yml`) on every pull request and on push to
`main`, so a red suite blocks the merge. They exit non-zero on failure and need no
dependency install — the `.gs` files are V8 JavaScript and parse/run under Node.
