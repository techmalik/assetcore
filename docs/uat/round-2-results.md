# AssetCore — UAT round 2 results

**Artifact (live plan and results):** https://claude.ai/code/artifact/cf07489b-e232-4cce-b93c-f9de90f236e7
**Branch:** `uat/round-1`
**Run date:** 7 September 2026
**Database:** `assetcore_integrate`
**Plan spec:** [uat/round-2.json](../../uat/round-2.json) · **built page:** [uat/uat.html](../../uat/uat.html)

Round 1 found 13 failures and fixed none. This round fixed them and retested each one by
repeating the exact test that failed, in the browser, as a user. Everything marked passed below
was watched happening on screen. Where a claim could not be made from the screen — a timezone
boundary that exists for one hour a day, and server-side capability enforcement — it is made by
an API test instead, and said so.

The database was read to *diagnose* three failures round 1 left undiagnosed (F10, F13, and the
new health defect). It was never used to decide whether a fix worked.

## Score

### Round 2

| Result | Count |
|---|---|
| Passed | 28 |
| Failed | 0 |
| **Not run** | **9** |
| **Total** | **37** |

### Round 1, restated after this round's fixes

| | Round 1 | Now |
|---|---|---|
| Failures | 13 | 0 outstanding as failures — 14 fixed, 1 unprovable (F3) |
| Blocked | 2 | 0 — both unblocked (r1t16 by F6, r1t38 by F10) |
| Never run | 22 | 5 covered, 17 still untested |

**The honest headline: 37 round-2 tests, 28 passed, 9 never run, nothing failed — but 17 of
round 1's original 22 untested cases are still untested, and the app has not had a clean
end-to-end pass.**

## API test suite

| | Tests | Files |
|---|---|---|
| Baseline before any change | 176 | 8 |
| After the fixes | **192** | **9** |

16 tests added in `apps/api/test/uatRound2.test.ts`, one corrected in `health.test.ts` (see
"A test that was wrong" below). No test was deleted or skipped.

```
TEST_DATABASE_URL=postgres://assetcore_app:assetcore_app@localhost:5432/assetcore_test \
TEST_DATABASE_URL_OWNER=postgres://$USER@localhost:5432/assetcore_test \
npm test -w @assetcore/api
```

## What was fixed

Ordered as they were worked, most user-blocking first.

### F8 — Work-order checklist and parts (four defects, not one)

1. Five names used and never imported in `WorkOrders.jsx` — `addWorkOrderTask`,
   `updateWorkOrderTask`, `deleteWorkOrderTask`, `addWorkOrderPart`, `deleteWorkOrderPart`.
   This was round 1's reported cause.
2. `PartsSection` read `wo.parts_lines`. `GET /work-orders/:id` returns
   `{ ...wo, activity, tasks, parts, defects }` — the key is `parts`. Reserved lines were
   written and never read back.
3. `lineQty()` was referenced twice and defined nowhere. It could not fire while the list was
   always empty; the moment lines rendered, the panel crashed to the error boundary.
4. `lineQty` read `quantity_used ?? quantity_required`, but the column defaults to `0.00`
   rather than null, so an unconsumed line showed `0×` and contributed ₦0 to the total. It now
   keys off `consumed_at`.

Verified: added, ticked and deleted a checklist step on WO-2025-0041 with real pointer clicks;
created a spare part; reserved it; saw `1× · Reserved · ₦185,000`; deleted one of two lines and
watched the total fall to ₦185,000.

### F1 — `/reports` readable by every role

`GET /reports` and `GET /reports/location-analytics` had no capability gate (only the POSTs
did), and the client route and nav item were ungated. All four now require `report:read`.
Additionally `total_nbv_cents` is returned as `null` to a caller without `depreciation:read` —
book value is depreciation data, and this rollup was the one place it was reachable without it.

### F4 — `*:read` silently satisfied `audit:read`

`packages/rbac` now carries `EXPLICIT_ONLY_CAPS = ['audit:read']`, which the wildcard does not
satisfy. This follows intent already in the file: `auditor: ['*:read', 'audit:read']` is only a
sensible thing to write if the author believed the wildcard did not cover it. It did — so the
Auditor's explicit grant was dead code and the Viewer inherited audit access, and with it an
Admin tab, by accident.

**Deliberately not changed:** the Viewer still sees Depreciation, Analytics and Reports, which
also arrive via `*:read`. Narrowing those would strip the Auditor too, and "should an Executive
see book value" is a product decision, not a bug fix.

### F10 — Depreciation preview 500

`ASSET_BASIS_COLUMNS` selected `commission_date`. The column does not exist. Migration 0021
says so explicitly: the other branch called it `commission_date`, "this lineage's name wins" —
`install_date`. Every basis lookup threw before reaching the typed 404/422 branches, so it
escaped as `internal_error`. The same fix corrected `Scan.jsx`, which rendered
`asset.commission_date` and therefore always showed a blank "Commissioned" field.

### F6 — Inspections could not carry an asset

The API always accepted `asset_id`; the form never offered it. Added an Asset select that also
settles the Site, plus a warning when it is left blank. Verified the whole way through: a
completed inspection at condition 2 now appears in the asset's health breakdown as
"Inspection condition 25/100 · Rated 2 of 5 on 7 Sept 2026".

### F14 — Orphaned account

`App.jsx`'s `gate()` now renders a `NoOrganisation` screen when an authenticated session has no
org, instead of letting every page render chrome and fail. Safe because members are invited and
there is no self-signup path, so authed-with-no-org can only mean a missing membership row.

### F13 — MTTR

`analytics.ts` built window bounds from `new Date().toISOString()` (UTC dates) and compared
them against `actual_end::date`, which resolves in the session timezone (Africa/Lagos). A job
closed at 00:13 local is 23:13 UTC the previous day, so its local date fell past a UTC upper
bound and the row was dropped. Both comparisons are now made in UTC.

**This one's browser evidence is weaker than the rest, and should be read that way.** At the
time of the retest the local and UTC dates agreed, so unfixed code would also have shown a
figure. The browser proves MTTR computes (0.02 h from 1 job, matching a 60-second repair); the
*boundary* is proved by two tests in `uatRound2.test.ts`.

### F5, F10, F14, F15 — raw API error codes

Fixed centrally. `apiClient` now carries the machine code on `err.code`, separate from the
message; `apps/app/src/lib/errors.js` maps ~60 codes to sentences behind
`errorText(err, fallback)`. The sweep replaced the displayed expression at 113 call sites across
25 files, keeping every bespoke sentence that already existed and replacing only the raw-code
fallback behind it. `errorText` falls back to the caller's own wording rather than echoing an
unknown code — showing the code is the bug this module exists to remove.

F5's other half: the Viewer's work-order panel no longer offers an Attach file link or a comment
box. Both post to routes gated on `wo:update`; offering them to a read-only role produced
controls that could only fail.

### F9 — approvals (partial, by choice)

Work-order **spend authorisation** can now be raised from the job. `POST /approvals` was already
generic over `entity_type` and `kind`, so this was a control, not a rewrite. Verified: ₦25,000
on WO-2025-0041 routed to the Operations Manager as Pending.

**Left undone on purpose:** `wo_closure`, `licence_renewal` and `pm_signoff` are still
unraisable. Each needs its own control in its own workflow — a closure gate that actually blocks
closing, a renewal flow on the licence record, a sign-off step on a PM task. That is feature
work. `wo_cost` was done because round 1 named it specifically: job spend above a threshold was
never gated.

### F7, F11, F12, F2, F15

- **F7** — completed inspections get a **View** action opening the completion modal in a
  read-only mode: per-item verdicts and notes, the rating with the others dimmed, findings, and
  only a Close button.
- **F11** — a new audit defaults to **Scheduled**, so the first Save succeeds.
- **F12** — `fmtMoney` caps its plain branch at 2 fraction digits, and `<Money>` formats the
  conversion at the same precision as the base figure beside it.
- **F2** — `/reset-password` renders whenever a token is present, shows whose session is active,
  and signs that session out on success so the new account can sign in.
- **F15** — the login limiter answers `{ error: 'too_many_attempts' }` instead of the library's
  bare text 429.

### New this round — the health score stopped explaining itself

Not a round-1 failure. Adding coordinates to an asset dropped its health from 69 to 31 while the
breakdown beneath it was unchanged and still summed to 69.

Two health engines existed. The asset PATCH route called the legacy SQL
`recompute_asset_health_for()` — a linear decay between the maintenance dates that writes
`health_score` and touches neither `health_score_components` nor `health_score_computed_at`. The
five-signal engine that produces the breakdown had replaced it everywhere else. Because the edit
form always submits both maintenance dates, **every** asset save took the legacy path.

Fixed by routing the PATCH through `refreshAssetHealth()` like every other write —
`assets.ts` already had a `recomputeDerived()` helper doing exactly that, and its own comment
said the five-signal engine had replaced the decay. Re-running the identical edit returned the
score to 69, matching the breakdown.

## A test that was wrong

`health.test.ts` asserted `health_score === 5` after a maintenance-date PATCH — the legacy decay
formula, hard-coded ("95 days elapsed of a 100-day window ⇒ 5%"). That was only ever true
because the PATCH route still used the legacy engine. Pinning it would pin the bug back.

Corrected to assert what the test is named for — that the recompute happens inside the request
rather than at 01:00 tomorrow — plus that the score reconciles with the breakdown written by the
same pass. The 30% auto-WO crossing keeps its coverage in the `apply_asset_health` tests above
it. The stale claim in the surrounding comment ("the maintenance dates are the only lever a user
has on health") was also corrected: under the five-signal engine the asset's own maintenance
dates are not a health input at all — the signal reads overdue PM tasks and work orders past
SLA.

## What is still not tested

**Three things this session's browser tooling cannot do**, recorded as not run rather than
guessed at:

1. **Photo upload, CSV import** — both open a native file picker. Driving them with script
   would fabricate the input rather than test it.
2. **Enter-to-submit (F3)** — the synthetic Return key does not trigger implicit form submission
   for *any* form in this app, including the simplest one. Neither a pass nor a fail can be
   claimed. **This needs thirty seconds from a human with a real keyboard.**
3. **Native `confirm()` dialogs** — auto-dismissed, so *Retire* on an escalation rule and
   *Disable* on a member cannot be completed. Both are one click for a person. **This is why
   the demo members are still enabled** — see below.

**Still untested from round 1's original 22:** QR sheets and the scan page (r1t48); CSV import
(r1t50); part consumption moving stock (r1t37 — the reservation half is done); report generation
and file-versus-screen comparison (r1t43); and most of "Input, sessions and the edges" (r1t57-64)
— phone width, dark mode, keyboard-only, double submit, search/filter/sort agreement, back
button after sign-out.

**Round-1 passes not re-clicked**, still resting on round 1's JS-driven evidence: the approval
matrix band editor and its three refusal paths (r1t18-23), the compliance findings flow
(r1t29-30), and the risk register (r1t32-34).

**Read but not proven:** the file endpoint's *authorisation* layer. An unauthenticated request is
refused (`{"error":"missing_token"}`, watched in the browser), and the per-bucket ownership
checks joined through RLS read correctly in `files.ts` — but nothing has ever been uploaded to
this instance, so cross-scope access to a real file is untested.

## Demo accounts

Unchanged from round 1, plus one created this round. **All still enabled** — see below.

| Role | Email | Password |
|---|---|---|
| System Admin (owner) | `a.okeke@ngml.example` | `Password123!` |
| Operations Manager | `uat.ops@assetcore.test` | `UatPass123!` |
| Maintenance Engineer | `uat.eng@assetcore.test` | `UatPass123!` |
| Field Technician | `uat.tech@assetcore.test` | `UatPass123!` |
| HSE / Compliance Officer | `uat.hse@assetcore.test` | `UatPass123!` |
| Auditor | `uat.auditor@assetcore.test` | `UatPass123!` |
| Executive / Viewer | `uat.viewer@assetcore.test` | `UatPass123!` |
| Field Technician *(new this round)* | `uat.enter@assetcore.test` | `UatPass123!` |
| *(orphaned, pre-existing)* | `paul.o@ngml.com` | `NgmlDemo2026` |

## State of `assetcore_integrate` after this round

**Restored, as asked:**
- `WO-2025-0038`'s SLA due date is back to **2026-09-09** (seed value: seed time + 3 days). It
  no longer reads as overdue.
- The **second currency is cleared** — the org is back to NGN only.

**Not done, and why:** the escalation rule *"UAT R1 — overdue work orders chase Ops"* is **still
active**, and the **demo members are still enabled**. Both actions are gated on a native
`confirm()` that this session's browser tooling auto-dismisses, so neither could be completed
through the UI, and the instruction was to clean up through the UI. Each is one click for a
person: Admin → Escalations → Retire, and Admin → Users & Roles → Disable. The escalation rule is
harmless as it stands — with the due date restored, "Run now" reports *"Nothing met a rule."*

**Created this round:**
- Spare part `SP-PT-1100` "Pressure transmitter 0-100 bar", unit cost ₦185,000, reorder level 3,
  **stock 2** (opening 8, issued 6 to exercise the low-stock signal — it is deliberately flagged
  *Reorder*).
- One reserved part line on `WO-2025-0041` (1 ×, not consumed).
- `WO-2025-0041` now carries a **cost of ₦25,000** and a **pending wo_cost approval** with the
  Operations Manager.
- Inspection *"UAT R2 - MTR-0042 condition check with asset attached"*, completed at condition 2
  against `NGML-MTR-0042`. This is what moved that asset's inspection signal to 25/100.
- Compliance audit *"UAT R2 - scheduled ISO 9001 surveillance audit"*, status Scheduled.
- Member `uat.enter@assetcore.test`.
- `NGML-MTR-0042` now has **coordinates** (6.4531, 3.3958) so the asset map could be tested with
  a real pin. Five assets still have none, which the map states.
- A **depreciation schedule on `NGML-CMP-0017`**, straight line, 15 years — **on a fabricated
  ₦45,000,000 basis, not the asset's real ₦980,000,000 purchase value.** The asset had no useful
  life recorded, so a basis had to be supplied to exercise the preview at all. **Nothing is
  posted** (0/15), deliberately: posting would have written five years of wrong charges to the
  books. Supersede or delete it before anyone reads the depreciation register as real. The
  schedule picker excludes assets that already have one, so this cannot be corrected through the
  UI — it needs a database change, which was not made without asking.

## Should this merge to main?

**The fixes: yes.** Fourteen real defects are closed, four of them security- or
data-integrity-relevant (`/reports` leak, audit-log exposure, the health score disagreeing with
its own explanation, and money rendering at three decimal places). The API suite went 176 → 192
with nothing skipped, and every fix was watched working in a browser.

**With three things understood first:**

1. **The error-message sweep touched 25 files and 113 call sites.** It is mechanical and
   conservative, and the app builds and passes, but only a subset of those error paths were
   reachable in one session. It is the change most worth a human eye on the diff.
2. **F3 is unresolved, not fixed.** If Enter genuinely does not submit forms, that is an
   accessibility defect this round could not confirm.
3. **17 of round 1's 22 untested cases are still untested**, including dark mode, phone width
   and keyboard-only navigation. This branch is *better*, not *verified*.
