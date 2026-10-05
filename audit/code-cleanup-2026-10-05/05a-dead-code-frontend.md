# 05a Dead code: frontend (apps/app, packages/ui, packages/rbac)

Baseline: commit 913e934 on main. Read-only audit. Findings are appended pass by pass.
Grep counts below are for `grep -rnw` (whole word) over the stated paths unless noted.

## Pass 1: unused files and unwired features

### DC-FE-01 `apps/app/src/pages/SpareParts.jsx` (509 lines): UNWIRED FEATURE (parked on purpose)

- Evidence: `grep -rn "SpareParts" apps/app/src apps/admin/src` finds no import of the page (only `listSpareParts` from the db helper, used by WorkOrders.jsx:21). `git log -S"import SpareParts"` shows it was imported in 5a413fa and un-imported in 913e934, whose message says: "Spare Parts is renamed and shown as coming soon; the route shows a holding page instead of the old screen."
- Route today: App.jsx:151 sends `/spare-parts` to `ComingSoon` ("Warehouse Inventory"). Sidebar.jsx:57 lists it with `soon: true` (inert).
- API backing: apps/api/src/routes/spareParts.ts, all live and mounted (routes/index.ts:63): GET `/spare-parts`, `/spare-parts/stats`, `/spare-parts/categories`, `/spare-parts/:id`, `/spare-parts/:id/movements`; POST `/spare-parts`, `/spare-parts/:id/adjust`, `/spare-parts/:id/assets`; PATCH `/spare-parts/:id`; DELETE `/spare-parts/:id`, `/spare-parts/:id/assets/:assetId`. RBAC caps `parts:read|create|update|adjust` exist in packages/rbac.
- Surprise: the catalogue is still half-live. WorkOrders.jsx:508 calls `listSpareParts()` (GET `/spare-parts`) to fill the "reserve a part" picker on a work order, but nobody can create a part in the UI any more. So the WO parts picker only shows seeded or pre-existing parts.
- Classification: UNWIRED FEATURE, owner decision. The commit says it is being reworked into Warehouse Inventory, so the old page is reference material for that rework. If the rework will be a rewrite, delete the page (509 lines) plus the 10 page-only helpers in lib/db/spareParts.js (see DC-FE-14). Confidence: high.

### DC-FE-02 `apps/app/src/components/DocumentsPanel.jsx` (158 lines) and `apps/app/src/lib/db/documents.js` (37 lines): UNWIRED FEATURE, leaning DEAD

- Evidence: `grep -rn "DocumentsPanel" apps/app/src apps/admin/src` returns only its own definition (count 0 imports). `git log -S"DocumentsPanel" -- apps/app/src` returns one commit (5a413fa, "port the new pages ... and the document panel they need"): it was ported and never mounted, not mounted-then-removed. lib/db/documents.js is imported only by DocumentsPanel.
- API backing: apps/api/src/routes/documents.ts (mounted at routes/index.ts:62): GET `/documents`, POST `/documents`, PATCH `/documents/:id`, DELETE `/documents/:id`. No other caller in apps/app or apps/admin (`grep -rn "/documents" ... | grep -v lib/db/` finds only the per-record endpoints below).
- The app already has a different, live document mechanism: per-record arrays via `/assets/:id/documents` (lib/db/assets.js:53,57, Assets.jsx:314-432) and `/compliance-licences/:id/document(s)` (CompliancePanel.jsx:193). So the typed `/documents` registry is a parallel second system, not a missing piece of the live one.
- Classification: UNWIRED FEATURE, owner decision. Recommendation: delete both files (195 lines) unless the plan is to move asset/licence/WO/inspection files onto the typed registry. Flag to API auditor (05b): `/documents` routes have zero frontend callers. Confidence: high.

### DC-FE-03 `apps/app/src/pages/NotConfigured.jsx` (28 lines) and every `isConfigured` branch: DEAD (unreachable)

- Evidence: apps/app/src/lib/apiClient.js:8 `export const isConfigured = true`, with a comment saying it is "Kept as a named export so call sites that still branch on it don't need to change shape (removed entirely in Phase 2's copy sweep)". The sweep never happened.
- Dead branches: App.jsx:3 (import), App.jsx:13 (import NotConfigured), App.jsx:175 `if (!isConfigured) return <NotConfigured />`; AuthContext.jsx:2 (import), :25 `if (!isConfigured) {...}`, :52 `!isConfigured ||`; auth.js:1,3 re-export `export { isConfigured }` (knip: unused).
- Also note the page copy is SaaS/dev-era: it tells a client to run `node scripts/seed-dev.mjs` and "Seed demo data". If the owner wants a real "API unreachable" screen it would need a real check (a failed health ping), which is a feature, not cleanup.
- apps/admin has its own copy of the same pattern (apps/admin/src/App.jsx:22 local NotConfigured, :105, apps/admin/src/lib/apiClient.js). Out of this file's scope but the same fix applies.
- Classification: DEAD. Delete NotConfigured.jsx, the `isConfigured` export and its 6 references. About 35 lines. Confidence: high.

### DC-FE-04 `apps/app/src/pages/ComingSoon.jsx` (33 lines): KEEP

- Evidence: imported at App.jsx:30, used once at App.jsx:151 for `/spare-parts`. It is the only route pointing at ComingSoon (`grep -n ComingSoon apps/app/src/App.jsx` = 2 hits: import + route).
- Classification: KEEP while Warehouse Inventory is parked. If DC-FE-01 is resolved (wired or deleted along with the sidebar entry), ComingSoon goes with it. Confidence: high.

### DC-FE-05 Inspection template management: UNWIRED FEATURE (found in pass 2, listed here because it is a feature gap)

- Evidence: lib/db/inspections.js:60 `createInspectionTemplate`, :64 `updateInspectionTemplate`, :68 `retireInspectionTemplate` have zero callers (`grep -rlw` over apps/app/src and apps/admin/src: 0 files). `grep -rn "/inspection-templates" apps/app/src apps/admin/src | grep -v lib/db/` = 0. Only `listInspectionTemplates` is used (to pick a template when raising an inspection).
- API backing: apps/api/src/routes/inspections.ts:292 GET, :302 POST, :328 PATCH, :346 DELETE `/inspection-templates`, gated on `inspection:update`.
- Effect: templates can be read and picked, but no screen in the tenant app or the backoffice can create, edit or retire one. They can only come from seed data or SQL. Introduced in 3ca66b8 ("Inspections UI: the checklist and rating the API now requires").
- Classification: UNWIRED FEATURE, owner decision (build a template editor in Admin, or delete the three helpers and keep templates seed-managed). Confidence: high.

## Pass 2: knip "unused exports" in apps/app, verified

Method: for each symbol, `grep -ow SYMBOL <file> | wc -l` (in-file count, includes the definition) and `grep -rlw SYMBOL apps/app/src apps/admin/src` (other files). Cross-file hits were opened and checked; where noted they are unrelated local namesakes, not imports. Script: scratchpad `exports.sh`.

Legend: DELETE = no use anywhere. UNEXPORT = used only in its own file, drop the `export` keyword. KEEP = reason given.

### Components and lib (non-db)

| ID | file:line | symbol | in-file | other files | class | notes |
|---|---|---|---|---|---|---|
| DC-FE-06 | components/AssetQr.jsx:7 | `assetQrValue` | 3 | 0 | UNEXPORT | used by AssetQrCode and PrintQrSheet in the same file |
| DC-FE-07 | components/InspectionsPanel.jsx:34 | `STATUS_META` | 3 | 2 (CompliancePanel.jsx:32, Devices.jsx define their own local `STATUS_META`) | UNEXPORT | used at :523 |
| DC-FE-07 | components/InspectionsPanel.jsx:41 | `KIND_META` | 4 | 1 (Notifications.jsx:9 own local) | UNEXPORT | used at :108, :524 |
| DC-FE-08 | components/SendForApproval.jsx:18 | `approvalErrorText` | 2 | 0 | UNEXPORT | |
| DC-FE-08 | components/SendForApproval.jsx:40 | `approverLabel` | 2 | 0 | UNEXPORT | |
| DC-FE-09 | lib/AuthContext.jsx:7 | `initialsOf` | 2 | 1 (Dashboard.jsx:56 defines a second, local `initialsOf`) | UNEXPORT (or KEEP and have Dashboard import it) | Duplicate implementation in Dashboard.jsx:56: refactor item for 05c, remove the Dashboard copy and import this one |
| DC-FE-10 | lib/auditLabels.js:15 | `ACTION_LABEL` | 3 | 0 | UNEXPORT | read through `actionLabel()` |
| DC-FE-10 | lib/errors.js:19 | `ERROR_MESSAGES` | 3 | 0 | UNEXPORT | read through `errorText()` |
| DC-FE-11 | lib/auth.js:3 | `isConfigured` (re-export) | 2 | n/a | DELETE | see DC-FE-03 |
| DC-FE-11 | lib/auth.js:82-85 | `currentOrgId` | 1 | 0 | DELETE | 4 lines; calls `/auth/me` via getSession, which stays used |
| DC-FE-11 | lib/auth.js:104-108 | `signInWithSSO` | 1 | 0 | DELETE | stub that throws "SSO is not enabled yet"; comment calls it "parked backlog". 5 lines. Owner may prefer to keep as a placeholder, but nothing calls it and the API has no SSO route |
| DC-FE-12 | lib/health.js:12,13 | `HEALTH_YELLOW_MAX`, `HEALTH_RED_MAX` | 2 each | 0 | UNEXPORT | used by `healthBand()` |
| DC-FE-12 | lib/health.js:28-31 | `healthTextColor` | 1 | 0 | DELETE | 4 lines |
| DC-FE-13 | lib/instance.js:3 | `INSTANCE_NAME` | 1 | 0 | KEEP (owner decision) | Deploy config sets `VITE_INSTANCE_NAME` (deploy/.env.deploy.example:47, scripts/package.mjs:9, apps/app/.env.example:8) but the app never shows it. Either it should be used (page title, sidebar, sign-in heading) or the env var is dead config. Flag, do not delete blind |
| DC-FE-13 | lib/money.jsx:30 | `CURRENCY_SYMBOL` | 1 | 0 | DELETE | 1 line |
| DC-FE-13 | lib/money.jsx:44 | `fmtMoney` | 3 | 0 | UNEXPORT | used inside `useMoney()`. Side note: its default `zero = '₦0'` is a leftover NGN hardcode that ignores `code` |
| DC-FE-13 | lib/money.jsx:69 | `convert` | 2 | 1 (Settings.jsx:229,276 only the English word "convert" in copy) | UNEXPORT | used inside `useMoney()` |

### lib/db API helpers (zero callers unless stated). Endpoint listed for the API auditor (05b).

| ID | file:line | symbol | in-file | other files | class | endpoint it calls | notes |
|---|---|---|---|---|---|---|---|
| DC-FE-14 | lib/db/assets.js:16 | `getAsset` | 1 | 0 | DELETE | GET `/assets/:id` | Assets page builds detail from list rows |
| DC-FE-14 | lib/db/complianceLicences.js:12 | `getComplianceLicenceCounts` | 1 | 0 | DELETE | GET `/compliance-licences/counts` | check if any other client uses the route |
| DC-FE-14 | lib/db/defects.js:26 | `OPEN_STATUSES` | 1 | 0 | DELETE | n/a (const) | 1 line |
| DC-FE-14 | lib/db/devices.js:20 | `getLatestReadings` | 1 | 0 | DELETE | GET `/devices/:id/readings` | |
| DC-FE-14 | lib/db/inspections.js:49 | `getInspection` | 1 | 0 | DELETE | GET `/inspections/:id` | |
| DC-FE-05 | lib/db/inspections.js:60,64,68 | `createInspectionTemplate`, `updateInspectionTemplate`, `retireInspectionTemplate` | 1 each | 0 | OWNER DECISION | POST, PATCH, DELETE `/inspection-templates[/:id]` | unwired feature, see DC-FE-05 |
| DC-FE-14 | lib/db/integrations.js:7 | `getIntegration` | 1 | 0 | DELETE | GET `/integrations/:kind` | Integrations page uses the list call |
| DC-FE-14 | lib/db/maintenanceEvents.js:3 | `listMaintenanceCompletions` | 1 | 0 | DELETE | GET `/assets/:id/maintenance-completions` | |
| DC-FE-14 | lib/db/maintenanceEvents.js:17 | `uploadMaintenanceCompletionReport` | 1 | 0 | DELETE | POST `/maintenance-completions/:id/report` | report is attached inside `completeMaintenance` form instead |
| DC-FE-15 | lib/db/org.js:9 | `updateOrg` | 2 (second is a comment at :14) | 0 | DELETE, or refactor callers onto it | PATCH `/org` | Endpoint is live: called directly with `api.patch('/org', ...)` at Settings.jsx:236, :348 and Onboarding.jsx:128. Either delete the helper (and fix the comment at org.js:13-16) or route those three calls through it (05c). Possible bug for 05b: org.js:7-8 says PATCH `/org` "replaces the settings jsonb wholesale", and Onboarding.jsx:128 sends `{ settings: { onboarded: true } }` without merging |
| DC-FE-14 | lib/db/pmSchedules.js:11 | `updatePMSchedule` | 1 | 0 | DELETE | PATCH `/pm-schedules/:id` | no edit-schedule UI |
| DC-FE-16 | lib/db/spareParts.js:3-13, 24-63 | `MOVEMENT_KINDS`, `MOVEMENT_LABEL`, `getSparePart`, `getPartStats`, `listPartCategories`, `createSparePart`, `updateSparePart`, `archiveSparePart`, `adjustStock`, `linkPartToAsset`, `unlinkPartFromAsset` | 1 each | 1 (SpareParts.jsx only, itself unused) | OWNER DECISION | `/spare-parts/*` | goes with DC-FE-01. `listSpareParts` stays (WorkOrders.jsx:508) |
| DC-FE-16 | lib/db/spareParts.js:53 | `listMovements` | 1 | 0 (not even SpareParts.jsx) | DELETE | GET `/spare-parts/:id/movements` | dead even inside the parked feature |
| DC-FE-17 | lib/db/workOrders.js:43,44 | `WO_STATUS_STYLE`, `WO_DRAFT_STYLE` | 2 each | 0 | UNEXPORT | n/a | read through `woStatusStyle()` |
| DC-FE-17 | lib/db/workOrders.js:80 | `softDeleteWorkOrder` | 1 | 0 | DELETE | DELETE `/work-orders/:id` | no delete-WO action in UI |
| DC-FE-17 | lib/db/workOrders.js:90 | `listWorkOrderTasks` | 1 | 0 | DELETE | GET `/work-orders/:id/tasks` | tasks arrive embedded in GET `/work-orders/:id` |
| DC-FE-17 | lib/db/workOrders.js:107 | `listWorkOrderParts` | 1 | 0 | DELETE | GET `/work-orders/:id/parts` | parts arrive embedded (WorkOrders.jsx:502-506 comment) |
| DC-FE-17 | lib/db/workOrders.js:115 | `updateWorkOrderPart` | 1 | 0 | DELETE | PATCH `/work-orders/:id/parts/:lineId` | no edit-quantity UI; add and delete only |

Verified: none of the endpoints above (except PATCH `/org`) is called directly with `api.*` anywhere outside lib/db (`grep -rn "<endpoint>" apps/app/src apps/admin/src | grep -v lib/db/` = 0 for each).

Pass 2 counts: 13 DELETE helpers/consts (about 45 lines), 13 UNEXPORT (0 lines removed, just the keyword), 1 KEEP-flag (`INSTANCE_NAME`), 14 tied to owner decisions (spare parts, inspection templates).

## Pass 3: dead code knip cannot see (non-exported locals, unused imports)

Method: Python scan (scratchpad `locals.py`) of every .js/.jsx under apps/app/src. For each `function X`, `const|let X =` (any indent, not exported) and each imported binding, count whole-word occurrences in the file with comments stripped. Flag count of 1 (definition only). Each hit then read by hand; one false positive (`pickPhoto` in Assets.jsx:405, hidden by `accept="image/*"` looking like a comment opener) discarded.

### DC-FE-18 `apps/app/src/pages/Devices.jsx:6` import `softDeleteDevice` (and `apps/app/src/lib/db/devices.js:16-18`): DELETE

- Evidence: `grep -rn softDeleteDevice apps/app/src apps/admin/src` = 2 hits: the definition and this import. Never called. knip missed it because the import exists.
- No delete-device action in the Devices UI. Endpoint for 05b: DELETE `/devices/:id` has no frontend caller.
- Removable: 1 import name + 3-line helper. Confidence: high.

### DC-FE-19 `apps/app/src/components/CompliancePanel.jsx:174-177` local `viewDocument()`: DELETE

- Evidence: `grep -nw viewDocument CompliancePanel.jsx` = 1 (definition). The detail panel renders `docList` (line 193) with its own per-document download buttons, which superseded this single-document helper.
- Removable: 4 lines. Confidence: high.

### DC-FE-20 Unused imports: DELETE

| file:line | binding | grep -nw count in file |
|---|---|---|
| components/CompliancePanel.jsx:11 | `useNavigate` | 1 |
| components/CompliancePanel.jsx:18 | `licenceStatus` (from lib/db/complianceLicences) | 1 |
| pages/Maintenance.jsx:1 | `useRef` | 1 |
| pages/Maintenance.jsx:14 | `api` (from lib/apiClient) | 1 |

`licenceStatus` itself is still used elsewhere (knip did not list it), so only the import goes. Removable: about 2 lines (Maintenance.jsx:14 is a whole line; the others are names inside a list). Confidence: high.

### DC-FE-21 `apps/app/src/pages/Maintenance.jsx:29` const `PRIORITY_COLOR`: DELETE

- Evidence: `grep -nw PRIORITY_COLOR Maintenance.jsx` = 1. Removable: 1 line. Confidence: high.

### DC-FE-22 Dead prop `prefill` on `DefectModal` (pages/Defects.jsx:59, :65) and `RiskModal` (pages/Risks.jsx:161, :168): DELETE (small)

- Evidence: the only call sites (Defects.jsx:583, Risks.jsx:673) never pass `prefill`; `grep -rn "prefill=" apps/app/src` = 0. Both came in 5a413fa, probably for a "raise a defect from an inspection" path that the separate `RaiseModal` now covers.
- Fix: drop `prefill` from both signatures and change `{ ...EMPTY, ...prefill }` to `{ ...EMPTY }`. 0 lines removed, 4 edits. Confidence: high.

### DC-FE-23 Context values nobody reads: UNEXPORT-style trim (low value)

- `AuthContext.jsx:69` `session` in the context value: no consumer destructures it (`grep -rn "session" apps/app/src` outside auth.js/AuthContext.jsx finds only comments and error strings). Internal state stays; only the field in `value` goes.
- `NotificationsContext.jsx:65` `refresh` in the context value: 0 consumers (tally of `useNotifications()` destructures: unreadCount, notifications, markRead, markUnread, markAllRead).
- `money.jsx:90-93` `useMoney()` returns `base`, `secondary`, `fxRate`, `fxRateAt`: 0 consumers (all 11 call sites destructure only `money`, `moneyFull`, `secondaryOf`, `rateNote`). About 3 lines (`base` is still needed internally).
- Classification: optional tidy. Confidence: high that they are unread; low value.

### Not found

- No unused `useState` pair: every state value flagged with 2 or fewer occurrences was read once in JSX (checked by hand, 38 candidates).
- No unused page props: all 23 routed pages destructure `{ dark, toggleDark }` and pass them to Topbar.

## Pass 4: comments, TODOs, debug leftovers, dead branches

- TODO/FIXME/XXX/HACK: 0 real hits (`grep -rnE "TODO|FIXME|XXX|HACK" apps/app/src` = 1, Scan.jsx:14 where `XXX` is a placeholder inside prose `ain=XXX`).
- `console.log` / `debugger`: 0. One `console.error` at components/ErrorBoundary.jsx:11, KEEP (that is the boundary's job).
- `if (false)` / `&& false` style: 0.
- Commented-out code blocks of more than 5 lines: 0. The two long `//` runs (lib/health.js:1-10, lib/errors.js:1-17) and every multi-line `{/* ... */}` block are prose explanations, not code.
- `useEffect` with an empty body: 0.
- Dead-by-constant branches: yes, the `isConfigured` branches. Covered in DC-FE-03.

## Pass 5: leftovers from the Supabase era and the SaaS era

Grep: `grep -rniE "supabase|\bsso\b|signInWithSSO|isConfigured|trial|subscription|\bplans?\b|billing|\bdemo\b|\bmock|\bsample|\bfake|lorem|stripe|pricing|tenant|saas|\bseat" apps/app/src` (placeholder= attributes excluded), plus a second grep for `user_metadata|Phase 2|legacy|compat`.

Result: no `supabase`, `trial`, `subscription`, `billing`, `stripe`, `pricing`, `mock`, `fake` data or `lorem` code remains. The hits that matter:

### DC-FE-24 Supabase session-shape shim in `apps/app/src/lib/auth.js:15-25, 56-61, 91-96` and `AuthContext.jsx:64`: KEEP for now, refactor candidate (05c)

- `sessionFromToken()` rebuilds a Supabase-style `{ access_token, user: { user_metadata: { full_name } } }` object from the custom API's `/auth/me` response, with the comment "Reconstructs the session shape the frontend already expects, so AuthContext/Sidebar/rbac call sites (session.access_token, session.user.user_metadata.full_name) survive unchanged."
- Today the only reader of `user_metadata` is AuthContext.jsx:64, and nobody outside AuthContext reads `session` (DC-FE-23). So the compatibility layer protects one line. Not dead, but it is the main remaining Supabase-era shape. Flatten in 05c: store `{ id, email, fullName, mustChangePassword }` directly. Confidence: high.

### DC-FE-25 `isConfigured` constant and NotConfigured page: DEAD (same as DC-FE-03)

- apiClient.js:5-8 comment promised removal "in Phase 2's copy sweep". Never removed. NotConfigured.jsx:21 still says "Seed demo data with node scripts/seed-dev.mjs", which is dev-only copy that would show to a client if the page were reachable.

### DC-FE-26 `signInWithSSO` stub, `apps/app/src/lib/auth.js:104-108`: DELETE (same as DC-FE-11)

- SSO/SAML is "parked backlog" per its comment. The stub only throws. No caller, no API route. Owner can keep a backlog note instead of code.

### DC-FE-27 Stale planning references in comments: TIDY (no code change)

- pages/Assets.jsx:36 calls the status model "David-demo-adopted" and cites TASK-4.2, and :45 "Legacy values (pre-TASK-4.2)". References a demo and a task id from the SaaS planning era that a maintainer cannot look up. Reword when touching the file.
- Legacy asset statuses `attention` / `critical` (Assets.jsx:37-47, 65, 1419-1467; API assets.ts:20-27): KEEP. They render existing rows. Removal needs a data migration first (convert remaining rows, then drop the values on both sides). Owner decision, not dead code. Whether any rows still carry them is a database question this audit did not check.

### DC-FE-28 "Coming soon" placeholders still in the UI: OWNER DECISION (product, not dead code)

| file:line | what |
|---|---|
| App.jsx:151, Sidebar.jsx:57, ComingSoon.jsx | Warehouse Inventory (see DC-FE-01) |
| pages/Settings.jsx:79 | text "Profile photo coming soon" under the avatar. No upload exists in the app. The API reads and returns `users.avatar_url` (apps/api/src/routes/profile.ts:19, :39) but has no upload route, so the column is always null unless set by SQL. |
| pages/Integrations.jsx:58-68 | SCADA / Historian card with `comingSoon: true` |
| pages/Integrations.jsx:190-191 | SAP and Termii cards show a permanently disabled sync button (`syncLabel`) titled "Commissioned per engagement". The config form saves to `/integrations/:kind` but nothing in the API consumes it (lib/db/integrations.js:11-12 comment: "No sync trigger"). |

These read as SaaS-era marketing surface. In a licensed on-prem build, the owner may prefer to hide unbuilt integrations per client rather than show them disabled.

### Hardcoded sample data

- 0 hardcoded fake datasets. CompliancePanel.jsx:3-4, Compliance.jsx:3, Maintenance.jsx:377, InspectionsPanel.jsx:3 and Inspections.jsx:3 all mention fake or demo data only in comments describing what was removed. Those history comments can be trimmed when the files are next touched.
- Assets.jsx:236 `example` row in the CSV import template (AST-001, "Compressor Unit X-5", Lagos): KEEP, it is the import template's sample row on purpose.
- "e.g. Lagos DS-04" placeholders (InspectionsPanel.jsx:103, CompliancePanel.jsx:121,472, Onboarding.jsx:202,213, Admin.jsx:236,433, Devices.jsx:90): KEEP, but note they assume a Nigerian client. If the product is sold outside Nigeria these placeholders should come from instance config. Out of scope for dead code.

## Pass 6: packages/ui/index.css (645 lines)

Correction to the brief: apps/admin does not use this file. apps/admin/src/main.jsx imports only `@mantine/core/styles.css` and `@mantine/notifications/styles.css`, and apps/admin/package.json has no `@assetcore/ui` dependency. The only consumer is apps/app/src/main.jsx:11. So "unused in apps/app" means unused, full stop.

Method: Python extraction of every `.class` in every selector (comments stripped): 82 distinct classes. For each, count whole-token occurrences (boundary = not `[\w-]`) across all of apps/app/src, which catches className strings, template literals and class names held in JS objects. Dynamic patterns found by searching for `name-${`: only `stat-row-${...}` (Dashboard.jsx:241, :244) and `assetcore-` (a localStorage key, not CSS).

### DC-FE-29 Unused CSS classes: DELETE

| class | index.css lines | uses in apps/app/src | uses in apps/admin/src | notes |
|---|---|---|---|---|
| `.btn-danger` | 208-209 | 0 | 0 | only `.btn-danger-soft` (210-211) is used (Admin.jsx:300, Assets.jsx:1310). Its comment at 207 covers both, keep the comment. 2 lines |
| `.kpi` | 236-242 | 0 | 0 | the KPI cards are `.stat-card` now; `.kpi-link` (243-256) is still used as a modifier on `.stat-card` (Dashboard.jsx:102), so keep `.kpi-link` and its comment header. 7 lines |
| `.modal-overlay` | 453-462 | 0 | 0 | added in 2971723 ("Mobile responsiveness ...") for a 92vw cap on phones, but every modal in the app is styled inline instead. 10 lines incl. comment |
| `.modal-card` | 463-469 | 0 | 0 | same. Also the only reader of `--modal-w`. 7 lines |

Owner note on the modal pair: deleting is the dead-code answer. The better answer may be the reverse (move the inline modal styles onto these classes, so the phone cap actually applies). That belongs in 05c refactor. Confidence for "unused": high.

### KEEP-dynamic

| class | lines | why |
|---|---|---|
| `.stat-row-2` .. `.stat-row-5` | 545-555 | built as `stat-row-${n}` in Dashboard.jsx:241, :244 (n clamped 2..5). All four reachable |

All other 76 classes have at least one literal use. Classes with exactly one use (sidebar-*, topbar-*, stat-card-*, notif-*, dash-*-grid, split-*, fact-grid, hide-tiny, badge-ip, aside-panel, kpi-link) were spot-checked; each single use is a real className.

### Custom properties

- 46 custom properties defined. Unused: `--b900` (index.css:18 light, :325 dark). `grep -rn "b900" apps/app/src packages/ui/index.css` finds only the two definitions. KEEP-optional: it completes the blue scale (50..900). Deleting saves 2 lines, low value. Confidence: high.
- `--modal-w` (index.css:464) is a hook a caller would set inline. No caller sets it (`grep -rn "modal-w" apps/app/src` = 0). Goes with `.modal-card`.
- `--accent` and `--panel-w` are set inline by components (Dashboard.jsx:102 and the detail panel) and read in CSS. KEEP.

### BUG-FE-01 (bug, not dead code): undefined custom property `--a500`

- apps/app/src/pages/NoOrganisation.jsx:29, :30, :31 use `stroke="var(--a500)"` / `fill="var(--a500)"`. `--a500` is not defined anywhere (`grep -rn "\-\-a500" packages/ui/index.css` = 0). The amber scale in this design system is `--sa / --sab / --sat / --sabr`.
- Effect: the warning icon on the "no organisation" screen draws with an invalid colour, so the circle and the bar have no stroke and the dot falls back to black. Fix: `var(--sa)`. Logged here because it surfaced in this pass; it is a one-line visual bug, not a cleanup.

## Pass 7: packages/rbac/index.js (205 lines)

Correction to the brief: apps/admin does not use @assetcore/rbac. It has its own platform-admin map at apps/admin/src/lib/rbac.js (roles superadmin/admin/support/billing, mirrored by apps/api/src/middleware/platformRbac.ts). Consumers of packages/rbac are apps/app (via lib/rbac.js) and apps/api.

### Exports, usage (`grep -rlw SYMBOL`, file counts, excluding the re-export files)

| export | apps/app | apps/admin | apps/api | verdict |
|---|---|---|---|---|
| `ROLE_CAPABILITIES` | 1 (Admin.jsx:16, :638 builds the role matrix) | 0 | re-exported by middleware/rbac.ts:7 only (knip: unused there) | KEEP |
| `can` | many | 0 (admin's `can` is its own) | many | KEEP |
| `GRANTABLE_CAPS` | 1 (Admin.jsx:16) | 0 | orgMembers.ts | KEEP |
| `ROLE_KEYS` | 1 (Admin.jsx:16) | 0 | orgMembers.ts and others | KEEP |
| `ADMIN_ENTRY_CAPS` | 3 (App.jsx, Sidebar.jsx, Admin.jsx) | 0 | 0 | KEEP |
| `ROLE_LABELS` | 4 | 0 (admin's is its own) | 0 | KEEP |
| `ROLE_RANK` | 0 | 0 | approvals.ts:323 via `import * as rbac` | KEEP. But see DC-FE-31 |
| `EXPLICIT_ONLY_CAPS` | 0 | 0 | 0 | UNEXPORT (DC-FE-30) |

### DC-FE-30 `packages/rbac/index.js` `EXPLICIT_ONLY_CAPS` (line 126): UNEXPORT

- Evidence: `grep -rlw EXPLICIT_ONLY_CAPS apps/` = 0 files. Used once inside `can()` in the same file.
- Action: drop `export`. 0 lines. Confidence: high.

### DC-FE-31 Defensive cast for `ROLE_RANK` in apps/api/src/routes/approvals.ts:321-323: refactor note for 05d

- `(rbac as { ROLE_RANK?: ... }).ROLE_RANK ?? {}` with the comment "ROLE_RANK is recent in @assetcore/rbac". It is in the package now and the package is a workspace dependency, so the fallback branch is dead. A plain `import { ROLE_RANK } from '@assetcore/rbac'` replaces it. Not frontend; passed to the API auditor.

### Capability strings: app code vs the map

Method: Python scan of every quoted `entity:action` string in apps/app/src and apps/api/src (comment lines skipped) against the 42 strings in packages/rbac.

- Every map capability is referenced by app or API code. No orphan capability in the map.
- App code references two strings that no role lists: `integration:manage` (Integrations.jsx:206) and `depreciation:manage` (Depreciation.jsx:354). Both are deliberately owner-only (granted only through owner's `'*'`), as the header comment at packages/rbac/index.js:20-23 says. Not a bug. The API enforces `depreciation:manage` (routes/depreciation.ts:182, :294, :320).
- Caps used only by the API, never by the app UI: `parts:read` (the parts picker on WorkOrders.jsx:508 is not gated on it; fine, the API answers 403 and the picker falls back to empty), `user:read`.
- API strings not in the map (`org:read`, `org:write`, `org:suspend`, `user:write`) all belong to the separate platform map in middleware/platformRbac.ts. Not a bug.

### BUG-FE-02 (security, for the API auditor, not dead code): `integration:manage` is checked by the UI only

- apps/app/src/pages/Integrations.jsx:206 hides the edit form unless `can(roleKey, 'integration:manage')` (owner only).
- apps/api/src/routes/integrations.ts:32 `PUT /integrations/:kind` has no `requireCap`. The table's RLS (db/migrations/0001_baseline.sql:977-979) only checks `org_id = current_org_id()`.
- Effect: any active member of the org, a Viewer included, can write integration config (SAP system URL, RFC username, Termii sender id, `enabled`) with a direct API call. The UI gate is the only gate. Logged here because pass 7 found it; belongs in the security / API findings.

## Pass 9: apps/app/src/lib/rbac.js vs packages/rbac

- apps/app/src/lib/rbac.js (13 lines) is a pure re-export: `export { ROLE_CAPABILITIES, can, GRANTABLE_CAPS, ROLE_KEYS, ADMIN_ENTRY_CAPS, ROLE_LABELS } from '@assetcore/rbac'`. No duplicate map. Its comment says it exists "to keep existing '../lib/rbac' import paths working".
- 20 files import from `../lib/rbac` (`grep -rl "lib/rbac" apps/app/src` = 20). Keeping the shim costs 13 lines and saves touching 20 imports. Classification: KEEP (optional: replace with direct `@assetcore/rbac` imports in a later sweep). Confidence: high.
- apps/api/src/middleware/rbac.ts:7 has the same kind of re-export; knip flags `ROLE_CAPABILITIES` there as unused (API auditor's call).

## Pass 8: npm dependencies and public files (apps/app)

### Dependencies (apps/app/package.json)

| package | used at | verdict |
|---|---|---|
| `@assetcore/rbac` | lib/rbac.js | KEEP |
| `@assetcore/ui` | main.jsx:11 | KEEP |
| `@fontsource-variable/bricolage-grotesque` | main.jsx:7 | KEEP |
| `@fontsource-variable/ibm-plex-sans` | main.jsx:8 | KEEP |
| `@fontsource/ibm-plex-mono` | main.jsx:9-10 | KEEP |
| `jsqr` | pages/Scan.jsx | KEEP |
| `qrcode.react` | components/AssetQr.jsx | KEEP |
| `react`, `react-dom`, `react-router-dom` | throughout | KEEP |
| dev: `@vitejs/plugin-react`, `vite` | vite.config.js | KEEP |

No unused dependency. knip agrees (its only unused-dependency hits are pino-pretty and pino-roll in apps/api).

### apps/app/public

| file | referenced by | verdict |
|---|---|---|
| manifest.json | index.html:12 | KEEP |
| apple-touch-icon.png | index.html:13 | KEEP |
| icon-192.png, icon-512.png | manifest.json icons | KEEP |

No unused public file. `apps/app/dist/` and `apps/app/.env` exist on disk but are not tracked (`git ls-files` = 0), so nothing to clean in the repo.

Side note: index.html:6 hardcodes `<title>AssetCore</title>` and manifest.json hardcodes the name, while `VITE_INSTANCE_NAME` is plumbed through deploy config but read by nothing (DC-FE-13). If per-client branding matters, this is where it would go.

### Outside scope, seen in passing

- Repo root has an empty `supabase/` directory (`supabase/functions`, `supabase/snippets`, both empty, untracked: `git ls-files supabase` = 0). Leftover from the Supabase era on this machine only; safe to `rmdir`, nothing in git.
- apps/admin/src/lib/rbac.js has a `billing` platform role and `billing:read` / `billing:write` caps (mirrored in apps/api/src/middleware/platformRbac.ts). That is a SaaS-era concept in a licensed on-prem product. For whoever audits the backoffice.
- Onboarding.jsx:128 sends `PATCH /org { settings: { onboarded: true } }` while lib/db/org.js:7-8 warns that PATCH `/org` replaces the settings jsonb wholesale. Harmless on a fresh org (nothing else in settings yet), but worth a check in 05b.
- `GET /org` and `PATCH /org` return an `organizations.plan` column (apps/api/src/routes/org.ts:26, :84, :116). Nothing in apps/app reads `org.plan` (`grep -rn "\.plan\b" apps/app/src` = 0) and the backoffice says every org is licensed with no plan tiers (apps/admin/src/components/StatusBadge.jsx:5). SaaS-era column, for 05b.

## Summary

Line estimates count the definition, its comment and the blank line after it. UNEXPORT items remove 0 lines. "Owner decision" lines are only removed if the owner picks delete.

| ID | file | symbol | action | lines removable (est.) |
|---|---|---|---|---|
| DC-FE-01 | apps/app/src/pages/SpareParts.jsx | SpareParts page (parked Warehouse Inventory) | owner decision | 509 |
| DC-FE-02 | apps/app/src/components/DocumentsPanel.jsx, lib/db/documents.js | DocumentsPanel + `/documents` helpers (never mounted) | owner decision (lean delete) | 195 |
| DC-FE-03 | apps/app/src/pages/NotConfigured.jsx, lib/apiClient.js:5-8, App.jsx:3,13,175, AuthContext.jsx:2,25,52, auth.js:1,3 | `isConfigured` (always true) and NotConfigured page | delete | 36 |
| DC-FE-04 | apps/app/src/pages/ComingSoon.jsx | ComingSoon | keep (goes with DC-FE-01 if resolved) | 0 (33 later) |
| DC-FE-05 | apps/app/src/lib/db/inspections.js:60-70 | create/update/retireInspectionTemplate | owner decision (build editor or delete) | 12 |
| DC-FE-06 | components/AssetQr.jsx:7 | `assetQrValue` | unexport | 0 |
| DC-FE-07 | components/InspectionsPanel.jsx:34,41 | `STATUS_META`, `KIND_META` | unexport | 0 |
| DC-FE-08 | components/SendForApproval.jsx:18,40 | `approvalErrorText`, `approverLabel` | unexport | 0 |
| DC-FE-09 | lib/AuthContext.jsx:7 | `initialsOf` (duplicate in Dashboard.jsx:56) | unexport, or dedupe in 05c | 0 (about 10 if Dashboard copy removed) |
| DC-FE-10 | lib/auditLabels.js:15, lib/errors.js:19 | `ACTION_LABEL`, `ERROR_MESSAGES` | unexport | 0 |
| DC-FE-11 | lib/auth.js:82-85, 104-108 | `currentOrgId`, `signInWithSSO` | delete | 11 |
| DC-FE-12 | lib/health.js:12-13, 28-31 | `HEALTH_*_MAX` unexport; `healthTextColor` delete | unexport + delete | 5 |
| DC-FE-13 | lib/instance.js:3, lib/money.jsx:30,44,69 | `INSTANCE_NAME` keep-flag; `CURRENCY_SYMBOL` delete; `fmtMoney`, `convert` unexport | mixed | 1 |
| DC-FE-14 | lib/db/assets.js:16, complianceLicences.js:12, defects.js:26, devices.js:20, inspections.js:49, integrations.js:7, maintenanceEvents.js:3,17, pmSchedules.js:11 | 9 zero-caller helpers/consts | delete | 36 |
| DC-FE-15 | lib/db/org.js:9 | `updateOrg` (endpoint called directly instead) | delete (or route the 3 direct calls through it) | 5 |
| DC-FE-16 | lib/db/spareParts.js:3-13, 24-63 | 11 page-only helpers; `listMovements` | `listMovements` delete; rest owner decision with DC-FE-01 | 4 (+46 owner) |
| DC-FE-17 | lib/db/workOrders.js:43-44, 80, 90, 107, 115 | `WO_*_STYLE` unexport; 4 dead helpers | unexport + delete | 16 |
| DC-FE-18 | pages/Devices.jsx:6, lib/db/devices.js:16 | `softDeleteDevice` (imported, never called) | delete | 4 |
| DC-FE-19 | components/CompliancePanel.jsx:174-177 | `viewDocument` | delete | 5 |
| DC-FE-20 | CompliancePanel.jsx:11,18; Maintenance.jsx:1,14 | unused imports `useNavigate`, `licenceStatus`, `useRef`, `api` | delete | 1 |
| DC-FE-21 | pages/Maintenance.jsx:29 | `PRIORITY_COLOR` | delete | 1 |
| DC-FE-22 | pages/Defects.jsx:59,65; pages/Risks.jsx:161,168 | `prefill` prop never passed | delete (edit only) | 0 |
| DC-FE-23 | AuthContext.jsx:69, NotificationsContext.jsx:65, money.jsx:90-93 | context fields `session`, `refresh`, `useMoney().base/secondary/fxRate/fxRateAt` | delete (optional) | 4 |
| DC-FE-24 | lib/auth.js:15-25 | Supabase session-shape shim | keep, flatten in 05c | 0 |
| DC-FE-25 | (same as DC-FE-03) | NotConfigured copy "Seed demo data" | see DC-FE-03 | 0 |
| DC-FE-26 | (same as DC-FE-11) | `signInWithSSO` | see DC-FE-11 | 0 |
| DC-FE-27 | pages/Assets.jsx:36,45 | "David-demo / TASK-4.2" comments; legacy asset statuses | tidy comment; statuses keep (needs data migration) | 0 |
| DC-FE-28 | Settings.jsx:79; Integrations.jsx:58-68, 190-191 | "Profile photo coming soon", SCADA coming soon, disabled sync buttons | owner decision (product) | 0 |
| DC-FE-29 | packages/ui/index.css:208-209, 236-242, 453-469 | `.btn-danger`, `.kpi`, `.modal-overlay`, `.modal-card` | delete (or adopt modal classes, 05c) | 26 |
| DC-FE-30 | packages/rbac/index.js:126 | `EXPLICIT_ONLY_CAPS` | unexport | 0 |
| DC-FE-31 | apps/api/src/routes/approvals.ts:321-323 | defensive `ROLE_RANK` cast | 05d refactor | 0 |
| (pass 6) | packages/ui/index.css:18, 325 | `--b900` | keep (optional delete) | 0 (2) |
| BUG-FE-01 | pages/NoOrganisation.jsx:29-31 | `var(--a500)` undefined | fix (bug) | 0 |
| BUG-FE-02 | apps/api/src/routes/integrations.ts:32 | PUT `/integrations/:kind` has no capability check | fix (security, API) | 0 |

### Totals

- Confirmed removable now (delete class, no owner input needed): about **155 lines** across DC-FE-03, 11-21, 23 and 29.
- Owner decisions, if all answered "delete": about **795 more lines** (SpareParts page 509, its helpers 46, ComingSoon 33 once nothing points at it, DocumentsPanel + documents.js 195, inspection-template helpers 12).
- Upper bound: about **950 lines**, roughly 5% of apps/app (18.5k).
- UNEXPORT only (0 lines, tidier surface): 13 symbols in apps/app plus 1 in packages/rbac.
- Unused CSS: 4 classes of 82, 1 custom property of 46. Unused npm deps: 0. Unused public files: 0.

### Unwired features (owner decides: wire up or delete)

1. Warehouse Inventory / Spare Parts (DC-FE-01, DC-FE-16): full page and 11 API routes exist; parked on purpose in 913e934. The WO "reserve a part" picker still reads the parts catalogue, with no UI left to add parts.
2. Typed document registry (DC-FE-02): DocumentsPanel and 4 `/documents` routes were ported in 5a413fa and never mounted. The app uses per-record document arrays instead.
3. Inspection template management (DC-FE-05): 3 API routes and 3 client helpers, no screen in app or backoffice.
4. Smaller: device delete (DC-FE-18, DELETE `/devices/:id`), work-order delete (DC-FE-17, DELETE `/work-orders/:id`), PM schedule edit (DC-FE-14, PATCH `/pm-schedules/:id`), profile photo (DC-FE-28, `users.avatar_url`). Each has an API route and a client helper but no UI. These are listed as delete above because nothing suggests they were meant to ship; flag to the owner if any was.

### For the API auditor (05b): endpoints with no frontend caller after this audit

GET `/assets/:id`, GET `/compliance-licences/counts`, GET `/devices/:id/readings`, DELETE `/devices/:id`, GET `/inspections/:id`, POST/PATCH/DELETE `/inspection-templates`, GET `/integrations/:kind`, GET `/assets/:id/maintenance-completions`, POST `/maintenance-completions/:id/report`, PATCH `/pm-schedules/:id`, DELETE `/work-orders/:id`, GET `/work-orders/:id/tasks`, GET `/work-orders/:id/parts`, PATCH `/work-orders/:id/parts/:lineId`, all `/documents` routes, all `/spare-parts/*` except GET `/spare-parts`. Check apps/admin and scripts before deleting any of them.
