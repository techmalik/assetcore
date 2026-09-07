# AssetCore — UAT round 1 results

**Artifact (live plan and results):** https://claude.ai/code/artifact/cf07489b-e232-4cce-b93c-f9de90f236e7
**Branch:** `uat/round-1` (cut from `main` @ 77173e0)
**Run date:** 6–7 September 2026
**Database:** `assetcore_integrate`
**Plan spec:** [uat/round-1.json](../../uat/round-1.json) · **built page:** [uat/uat.html](../../uat/uat.html)

Everything below was driven through the browser at `http://localhost:5174`. Nothing was
verified with curl, psql or any other direct call to the API or database. Where the cause of
a failure is named, it comes from reading source, not from querying state.

## Score

| Result | Count |
|---|---|
| Passed | 28 |
| **Failed** | **13** |
| Blocked (cannot be run until another failure is fixed) | 2 |
| Not run (session ended first) | 22 |
| **Total** | **65** |

22 tests were not reached. The whole of "The rest of the surface" (calendar, asset map, QR
sheets, photo upload and lightbox, CSV import) and most of "Input, sessions and the edges"
are untested, along with spare parts and stock movements. Round 2 should start there — the
photo/file access-control test in particular, since an unauthenticated file URL is the kind
of hole this round never got to look at.

## Demo accounts

All six were created through the UI as the owner (Admin → Users & Roles → Invite), the
invite link opened, and a password set. **All are left enabled for session 2.**

| Role | Email | Password |
|---|---|---|
| System Admin (owner, pre-existing) | `a.okeke@ngml.example` | `Password123!` |
| Operations Manager | `uat.ops@assetcore.test` | `UatPass123!` |
| Maintenance Engineer | `uat.eng@assetcore.test` | `UatPass123!` |
| Field Technician | `uat.tech@assetcore.test` | `UatPass123!` |
| HSE / Compliance Officer | `uat.hse@assetcore.test` | `UatPass123!` |
| Auditor | `uat.auditor@assetcore.test` | `UatPass123!` |
| Executive / Viewer | `uat.viewer@assetcore.test` | `UatPass123!` |
| *(broken, pre-existing — no membership row)* | `paul.o@ngml.com` | `NgmlDemo2026` |

To use an invite link you must be signed out first — see F2.

## The three worst

1. **F8 — the work-order task checklist and parts are dead.** Missing imports; every action
   throws a ReferenceError behind a native alert. This is the headline of the most recent
   commit and it has never worked in a browser.
2. **F1 — `/reports` leaks financials to every role.** The Field Technician, with no
   `report:read` and no `depreciation:read`, reads per-location total value and book value.
   Unguarded on both the client route and the API.
3. **F14 — the orphaned account lands on a broken dashboard.** Signs in fine, then shows
   `no_org_context` in a red banner with every figure dashed out and no explanation.

## Failures


## F1 — HIGH — /reports and its financial analytics are not permission-gated (server or client)
Signed in as UAT Field Technician (field_tech: no `report:read`, no `depreciation:read`).
- Nav shows **Reports**; `/reports` opens fully.
- Its **Analytics** tab renders per-location financials: Total value N1.4B, Book value N609.4M,
  WO cost, avg health — the same class of data `/analytics` and `/depreciation` block for this role.
- Network: `GET /api/reports?limit=50` -> 200 and `GET /api/reports/location-analytics` -> 200.
- Code: apps/app/src/App.jsx `/reports` route has no `can(...)` guard (unlike `/analytics`);
  apps/api/src/routes/reports.ts:26 and :41 have no `requireCap('report:read')` (the POSTs do).
Server-side leak, not just a hidden-nav problem. Book value is depreciation data.

## F2 — MEDIUM — An invite link opened while signed in silently redirects to the dashboard
The admin who generates the invite is holding the link and is signed in. Pasting
`/reset-password?token=...` redirects to `/dashboard` with no message (App.jsx: the
`/reset-password` route redirects when `authed`). Nothing tells you to sign out first,
and the token looks broken. Same applies to `/forgot-password`.

## F3 — LOW — Enter does not submit the Invite a team member form
Filled name/email/role, pressed Enter in the name field: nothing happened. Had to click
Send Invite. Form is a real `<form>` with a submit button, so Enter should work.

## F4 — HIGH — The Viewer role reaches Admin and reads the whole audit log
UAT Viewer ("Executive / Viewer — read-only access to dashboard and reports") signs in and
gets **Admin** in the nav. `/admin` opens with Escalations and Audit Log tabs, and the
Audit Log lists all 10 org events with actor, action, entity and timestamp — including who
invited which member.
Cause: `can()` in packages/rbac/index.js returns true for ANY `:read` capability when the
role holds `*:read`. Viewer is `['*:read']`, so it satisfies `audit:read`, which is in
`ADMIN_ENTRY_CAPS`.
The intent is visible in the same file: `auditor: ['*:read', 'audit:read']` lists audit:read
explicitly and redundantly — that only makes sense if the author believed `*:read` did not
cover it. It does, so the Auditor's explicit grant is dead and the Viewer inherited audit
access by accident.
Viewer also gets Depreciation and Analytics in the nav for the same reason.

## F5 — LOW/MEDIUM — Read-only roles are offered write controls that then fail
As UAT Viewer, the work-order detail panel (WO-2025-0039) shows an "Attach file" link and a
comment box with a **Post** button. Typing a comment and pressing Post is correctly refused
by the API — but the toast reads just **"forbidden"**, the raw API error code, with no
human explanation. Enforcement is right; the affordance and the message are wrong.

## F6 — HIGH — An inspection cannot be attached to an asset, so its rating feeds nothing
The New Inspection form (Inspections -> New Inspection) has Title, Type, Scheduled date,
Checklist, **Site**, Inspector, Notes — and no **Asset** field. Every seeded inspection has an
asset (NGML-SCR-041 etc.); both inspections I created through the UI show ASSET = "—".
The completion dialog states the 1-5 rating is "A quarter of the asset's condition score",
and the asset health breakdown reads inspection ratings — but a UI-created inspection has no
asset, so its rating cannot reach any asset's score. The defect raised from it also inherits
a blank asset (DEF-2026-0001, ASSET "—"), and so does the work order raised from that
(WO-2026-0002, ASSET "—"). The whole chain loses the asset at step one.

## F7 — MEDIUM — A completed inspection has no detail view
Clicking a completed inspection row does nothing. There is no way to read back the checklist
results, the per-item notes, the condition rating or the full findings after completion — the
list shows only a truncated findings preview. Defects can only be raised from a failed item
*during* completion; miss it and there is no later route from the inspection to the register.

## F8 — HIGH — Work-order checklist and parts are completely dead (missing imports)
On WO-2026-0002 as UAT Field Technician: typing a step and pressing Add (or Enter) does
nothing — no request is sent. Console: a suppressed native alert reading
**"addWorkOrderTask is not defined"**.
apps/app/src/pages/WorkOrders.jsx uses `addWorkOrderTask` (:288), `updateWorkOrderTask` (:280),
`deleteWorkOrderTask` (:294) and `addWorkOrderPart` (:353), but its import block from
`../lib/db/workOrders` (:6-10) lists none of them — it stops at `uploadWorkOrderAttachment`.
All four exist in apps/app/src/lib/db/workOrders.js (:94, :98, :102, :111).
So every checklist action (add, tick, delete) and the parts add all throw ReferenceError.
The only user-visible signal is a raw `alert(e.message)` with a JavaScript error string.
This is the headline of commit d436689 "Work order detail: task checklist, parts and the
defect it came from" and it has never worked in the browser.
Also: the "Add a part…" dropdown renders with no options even though GET /api/spare-parts
returns 200.

## F9 — HIGH — Only one of the five approval kinds can actually be raised
Approvals -> Matrix lets an owner configure bands for Work order (Spend authorisation,
Closure sign-off), Defect (Deferral), Licence (Renewal) and PM task (Sign-off). I created a
work-order spend band ₦1,000–₦50,000 and there is no control anywhere in the app that raises
a wo_cost or wo_closure request — the work-order detail has no "request approval" or
"send for sign-off" action, and setting a Cost does not create one.
In the source, `submitApproval` has exactly one caller: apps/app/src/pages/Defects.jsx:246,
the defect-deferral flow. So four of the five configurable approval kinds are dead ends: an
owner can build a spend-authorisation matrix that will never be used, and job spend above a
threshold is never actually gated.

## F10 — HIGH — Depreciation schedules cannot be created: the preview 500s
Depreciation -> Create first schedule -> pick asset NGML-CMP-0017, method Straight line.
The preview panel renders the word **internal_error** where the schedule table should be.
Network: `POST /api/depreciation/preview` -> **500 Internal Server Error**, every time
(reproduced on asset selection and again on method change). API log shows the request
errored with status 500 and no handler-level detail.
The handler at apps/api/src/routes/depreciation.ts:146 returns typed 404/422 for
not_found / unsupported_method / incomplete_basis, so a 500 means the failure is before
those branches — it escapes `withOrgContext`, most likely the
`select ${ASSET_BASIS_COLUMNS} …` at :152 (ASSET_BASIS_COLUMNS at :80-81 reads
purchase_value_cents, salvage_value_cents, useful_life_years, depreciation_method,
commission_date, purchase_date).
Consequence: no schedule can be created, so net book value can never come from a posted
schedule — the Depreciation page's own headline ("net book value comes from posted
entries") cannot be satisfied. The 500 is surfaced to the user as the raw string
`internal_error`.
NOT diagnosed further: doing so would need a database session, which this round did not use.

## F11 — MEDIUM — A new compliance audit defaults to "Completed"
Compliance -> Audits -> + New Audit opens with Status already set to **Completed**, so the
first Save is always refused with "An outcome is required to complete an audit". Scheduling
an audit — the normal reason to create one — takes an extra step to undo a default nobody
would want.

## OBSERVATION — Approving a deferral does not defer the defect
DEF-2026-0002's deferral was approved (Approvals shows Approved, the defect's DEFERRAL panel
reads "Decided / Approved") but the defect itself stays **Open** in the register; "Deferred"
remains a manual status change with nothing prompting it. Defensible as a design, but the
register currently shows an approved-for-deferral defect as ordinary Open work.

## F12 — LOW/MEDIUM — Secondary-currency amounts render with three decimal places
With the second currency set to USD at 0.00065, the asset panel for NGML-MTR-0042 shows:
  Purchase value        ₦240,000,000.00  ($156,000)
  Book value (NBV)      ₦150,066,666.67  ($97,543.333)
  Accumulated deprec.   ₦89,933,333.33   ($58,456.667)
The base currency is correctly 2 dp; the converted figure runs to 3 dp on two of the three
lines and to 0 dp on the third. Money should be a consistent 2 dp everywhere.

## F13 — MEDIUM — MTTR never computes, even after a corrective job is closed in-app
I drove WO-2026-0002 (type CORRECTIVE, raised from DEF-2026-0001) New -> Assigned ->
In Progress -> Awaiting Parts -> In Progress -> Inspection -> Closed through the UI on
7 Sept 2026. Analytics still reads:
  MTTR  **Not known** — "No corrective jobs were closed in this period"
for all three windows (Last 30 days / Last 90 days / Last 12 months). MTBF does move with
the window (1,116 / 3,276 / 13,176 operating hours), so the period selector works.
The code path looks right on inspection — apps/api/src/routes/workOrders.ts:419-420 stamps
actual_start on the move to in_progress and actual_end on the move to closed, FAILURE_TYPES
(analytics.ts:16) includes 'corrective', and meanTimeToRepair (kpis.ts:44) only skips rows
with a null or inverted pair. Something between those is not lining up; I did not diagnose
further because that needs a database session.
Also on the same page: OPEN BACKLOG says "Oldest has been open 0 days" while WO-2025-0038
is 17 days past its due date and older still.

## F14 — HIGH — The orphaned account signs in and lands on a broken dashboard
This is the case flagged before the run, and it reproduces exactly.
`paul.o@ngml.com` / `NgmlDemo2026` authenticates successfully and lands on **/dashboard**
with the full app chrome rendered. What the user sees:
  - org name and initial render as "—" and "?" in the sidebar
  - header reads "Network health overview · **Loading…**" and never resolves
  - a red banner: **"Failed to load dashboard data: no_org_context"**
  - every tile (Total Assets, Operational, Open Work Orders, Overdue PM, Compliance Alerts,
    My Open Work) shows "—"; the health donut shows "—"
It does not crash, loop or hang the browser, and Sign out works (returns to /auth) — so the
user is not trapped. But `/assets`, `/work-orders` and `/compliance` all render their chrome
and fail the same way with the raw string `no_org_context`. `/settings` opens with no error.
The nav is also silently truncated (no Spare Parts, Defects, Risk, Approvals, Depreciation,
Analytics, Admin) because with no membership the role key is undefined and every `can()`
check returns false.
Nothing tells the person what is wrong or what to do. The pass condition — an explanation
and a way out — is not met: a raw error code is not an explanation.

## F15 — MEDIUM — No sign-in rate limiting, and failures show a raw error code
Seven consecutive wrong-password attempts on `a.okeke@ngml.example` were all refused and
never triggered a lockout, delay or captcha; the correct password then signed in normally.
Each failure displays the literal string **`invalid_credentials`** rather than a sentence.
Good: an unknown address (`nobody.here@assetcore.test`) returns the *same* message, so the
form does not leak which accounts exist.

## Cross-cutting: raw API error codes are shown to users
Collected across the run, the UI surfaces bare API error strings where a sentence belongs:
`invalid_credentials` (sign-in), `no_org_context` (dashboard/assets/work orders/compliance),
`forbidden` (Viewer posting a comment), `internal_error` (depreciation preview).
Contrast with the places that do it well — "The ceiling has to be above the floor.",
"An outcome is required to complete an audit…", "No approval rule covers defect deferrals
yet." — so the pattern exists, it is just not applied consistently.

## What passed and is worth keeping

Several things are notably well built and should not be disturbed by the fixes:

- **The asset health breakdown.** "Show the working" names each signal, its score and its
  weight, reconciles exactly to the headline number, and explains why a signal with no
  evidence is excluded rather than counted as zero.
- **Approval routing and its refusals.** Self-approval, wrong-role decisions and
  requester-only recall all behave correctly, and the band validation says "The ceiling has
  to be above the floor." rather than echoing a code.
- **Escalation trigger narrowing.** The form offers exactly the entity/trigger pairs the
  evaluator can act on, checked against the API's own table for all six entities. Re-running
  does not re-fire.
- **Work-order state machine and provenance.** Every transition matched `WO_TRANSITIONS`,
  Closed is genuinely terminal, and the defect → work order link reads correctly in both
  directions with "Closing this job resolves it".
- **Empty states.** Consistently written as explanations rather than bare zeros.

## Fixed during the run

Nothing. No application code was changed. Every failure above is left in place for session 2.

## Environment changes made during the run

Two stale dev-server processes from an earlier session were holding ports 8787 and 5174 (an
API from 22:03 and a Vite server). I stopped both and restarted the servers from
`.claude/launch.json` so the app, the API and its logs were the ones under test and so that
invite links matched `APP_ORIGIN=http://localhost:5174`. Both servers also died once
mid-run and were restarted; no data was affected.

## State left behind in `assetcore_integrate`

Nothing was deleted. Session 2 will find:

**Members** — six new users and memberships (`uat.*@assetcore.test`), all Active. Left
enabled deliberately.

**Inspections** — two completed, both with no asset (F6):
- `UAT R1 — Warri Terminal A condition check` (condition 2, one failed checklist item)
- `UAT R1 — Lagos DS-04 metering integrity` (condition 2, failed item pushed to a defect)

**Defects** — four:
- `DEF-2026-0001` Check gas leak detector — Major, **Resolved** (closed by WO-2026-0002)
- `DEF-2026-0002` metering skid vibration above limit — Major, **Open**, deferral approved
- `DEF-2026-0003` self-approval probe — Moderate, **Open**, deferral recalled
- `DEF-2026-0004` raised from the audit finding — **Open**

**Work orders**
- `WO-2026-0002` raised from DEF-2026-0001, **Closed**
- `WO-2025-0038` (seeded) — **its SLA due date was changed to 2026-08-20** so it would be
  overdue and trigger an escalation. It now reads "Overdue 17d". Change this back if a clean
  backlog matters to session 2.

**Approval rules** (two, both mine)
- `UAT band — job spend ₦1,000 to ₦50,000` — work_order / wo_cost → Operations Manager
- `UAT — defect deferral sign-off` — defect / deferral, any amount → Operations Manager

**Approvals** — one Approved (DEF-2026-0002), one Recalled (DEF-2026-0003).

**Escalation rule** — `UAT R1 — overdue work orders chase Ops`, active, fired once.
It will keep evaluating on the 07:15 cron.

**Compliance** — `AUD-2026-0001` "UAT R1 — ISO 14001 internal audit, Lagos DS-04", completed,
outcome "Pass with findings", one major finding, defect raised from it.

**Risk** — one live risk, `UAT R1 — uncontrolled gas release at the Lagos DS-04 inlet`,
inherent 20 / residual 6.

**Organisation settings** — **a second currency was set: USD at 0.00065, dated 2026-09-01.**
This is why money now renders as `₦… ($…)` everywhere. Clear it in Settings → Organisation if
session 2 wants single-currency output.

I did not archive these records. They are the evidence for the failures above and several are
referenced by the findings, so removing them would make the round harder to re-check. Say the
word and I will archive them through the UI, or tell me if anything needs deleting at the
database level.
