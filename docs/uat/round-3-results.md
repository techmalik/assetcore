# AssetCore — UAT round 3 results

**Artifact (live plan and results):** https://claude.ai/code/artifact/cf07489b-e232-4cce-b93c-f9de90f236e7
**Branch:** `main`
**Run date:** 8 September 2026
**Where it ran:** local stack — app on `5174`, API on `8787`, database `assetcore_integrate`. **Not staging.**
**Plan spec:** [uat/round-3.json](../../uat/round-3.json) · **built page:** [uat/uat.html](../../uat/uat.html)

Rounds 1 and 2 closed fourteen defects but left seventeen of round 1's original untested cases still
untested, and re-clicked only some of round 1's JavaScript-driven passes. This round went after exactly
that surface. Everything marked passed below was watched happening on screen.

## Score

| Result | As run | After the fixes |
|---|---|---|
| Passed | 17 | **23** |
| Failed | **6** | 0 |
| Blocked | 0 | 0 |
| **Not run** | **1** | **1** |
| **Total** | 24 | 24 |

The run recorded all six failures **before anything was changed**. Each was then fixed and the same
card re-run in the browser as the role it names; every card's note keeps the original finding and
says what changed underneath it. The one card still not run is keyboard activation — see below.

API tests: **192 → 200**, eight added in `apps/api/test/uatRound3.test.ts`, none removed or skipped.

Cumulative, across all three rounds: 65 + 37 + 24 = 126 test cards, of which **32 have still never
been run** (22 from round 1, 9 from round 2, 1 from this round).

## The six failures — all fixed and re-run

### 1. QR labels are written and unreachable — *card 01*

`apps/app/src/components/AssetQr.jsx` exports a QR code, a printable 4-up label sheet and its own
print stylesheet. **Nothing imports it.** There is no Labels, QR or Print control anywhere on the
asset register or the asset detail, and no row selection. `apps/app/src/components/DocumentsPanel.jsx`
is dead in the same way.


**Fixed.** `AssetQr.jsx` is now imported by the asset register: a **Labels** button between Import CSV and
Add Asset opens the sheet for whatever the filters have narrowed the list to. Re-run: searching `Warri`
and pressing Labels produced *2 labels · 4 per row*, one QR each for `NGML-VLV-0089` and `NGML-SCR-041`.
The Print step itself needs a browser that allows pop-ups — the pane blocks them, and the component's own
fallback message fired correctly. `DocumentsPanel.jsx` is still dead; wiring it is a feature decision.
### 2. The CSV import template's example row is misaligned with its own headers — *card 22*

`CSV_HEADERS` has 18 columns; the example row at [Assets.jsx:228](../../apps/app/src/pages/Assets.jsx)
has **19 values** — a stray `'90'` between `value` and `last_maintenance_date`, left behind when
`health_score` was removed from the header list. Everything from column 14 on is one place left of its
header: `last_maintenance_date` gets `90`, `tags` gets a date, `lat` gets `critical,offshore`. Anyone
who edits the template in place imports wrong dates and wrong coordinates.


**Fixed.** The stray `'90'` is gone and a length assertion now sits beside the example so the two cannot
desynchronise silently again. Re-captured the blob the button produces: 18 headers, 18 values, every pair
correct. The import itself is still untested (native file picker).
### 3. An inverted approval band 500s instead of answering `invalid_band` — *card 09*

`POST /approval-rules` validates the band and returns `422 invalid_band`
([approvals.ts:97](../../apps/api/src/routes/approvals.ts)). The `PATCH` handler has no such check,
so the DB constraint `approval_rules_check` raises and it escapes as a **500**. The user is told
"Something went wrong at our end. Try again, and tell an administrator if it keeps happening." for a
mistake they could fix themselves. Create and edit disagree about the same rule.


**Fixed.** `PATCH /approval-rules/:id` now validates the band it will *produce* — merging the patch over the
stored row, so raising only the floor above an existing ceiling is caught too — and answers the same
`422 invalid_band` the create path does. Re-run: the same edit returns 422 and the modal reads
*"The ceiling has to be above the floor."* Five cases pinned in tests.
### 4. The Viewer is offered Generate Report, and the 403 is silent — *card 07*

`+ Generate Report` and the Generate tab are shown to a role holding only `*:read`. Pressing it sends
`POST /api/reports` → **403**, correctly. The screen says nothing: `handleGenerate` writes the message
to `err` ([Reports.jsx:83](../../apps/app/src/pages/Reports.jsx)) but `err` is only rendered inside the
Report Library branch ([Reports.jsx:128](../../apps/app/src/pages/Reports.jsx)), and `setTab('library')`
is only reached on success.


**Fixed.** The create affordances are gated on `report:create`, and the refusal now renders on the generate
tab as well as the library. Re-run as the Viewer: Report Library and Analytics only, no Generate control
anywhere, existing reports still readable and downloadable. Re-checked as the owner: all three tabs, and a
report generated end to end.
### 5. Dark mode does not persist, and 18 of 143 text elements fail AA — *card 15*

`App.jsx:68` is `useState(false)` — no `localStorage`, no `prefers-color-scheme`. Reload and the theme
is light again. Separately, measuring every text node against its resolved background: the dashboard
has 18 of 143 elements below WCAG AA, worst at **1.59:1** (the empty-state line "Preventive maintenance
tasks due soon will appear here"), and the work-order reference links drop to **1.79:1** in dark where
they are fine in light.


**Fixed, with one part deliberately left.** The theme now seeds from `localStorage`, falls back to
`prefers-color-scheme` on a first visit, and survives a reload (watched). The brand ramp is inverted for dark
like the neutral ramp already was, with `--b400`/`--b500` held back for the focus ring and the primary button
and a new `--b-solid` for fills that must carry white text in both themes; `--n300` stopped being used for
words in five places. Re-measured: dashboard **0 of 133 below AA, floor 5.19:1**; Analytics **0 of 131,
floor 4.68**.

**Left outstanding on purpose:** in *light* mode 17 of 133 elements still measure **2.67:1** — muted labels
using `--n400` at 70% lightness on white. Retuning the primary theme's neutral ramp changes every screen and
wants a designer across all of them. It is a design decision, not a bug fix.
### 6. One refusal in the round produced no message at all — *card 24*

No `snake_case` code reached a screen anywhere — round 2's sweep holds. But the standing check fails on
its other clause: the Viewer's report 403 is silent (see 4), and the approval-band 500 misdescribes a
client mistake as a server fault (see 3).


**Fixed** by 3 and 4 above. A third refusal was improved while there: closing a job against missing stock now
reads *"Not enough stock to close this job: SP-PT-1100 — need 12, 1 on hand."* instead of discarding the
shortfall list the API already returns.
## Defects found in passing — also fixed

Each was recorded on its own (passing) card during the run, then fixed and re-run.

- **The scan card reads fields nothing writes.** *(Fixed: the card reads the column first and `specs`
  second; re-run shows Manufacturer "UAT R3 Instruments". The underlying two-homes-for-one-field split is
  left as a migration decision.)* `Scan.jsx:197-200` renders `asset.manufacturer`,
  `asset.serial_number`, `asset.warranty_expiry`; the edit form and the CSV importer both write
  manufacturer/model/serial into the `specs` JSONB (`assets.ts:355-358`). Every row in `assets` has
  NULL in the real columns, so three of the six fields on the scan card can never fill. Proved by
  setting `NGML-MTR-0042`'s manufacturer and watching the list show it while the scan card showed `—`.
- **One 403 empties three pickers on the risk form.** *(Fixed: `Promise.allSettled`; re-run as the HSE
  officer shows all six assets and all five sites, with Owner correctly still empty.)* `Risks.jsx:375-378` loads assets, sites and org
  members in one `Promise.all` with an empty catch. An HSE officer gets 200 on assets and sites and
  **403 on `/api/org/members`**, so all three pickers render `— None —` only. Any role without
  `user:manage` cannot attach a risk to an asset — the same shape as F6, which round 2 fixed for
  inspections.
- **`insufficient_stock` discards its detail.** *(Fixed and re-run — the message now names the part and the
  shortfall.)* The API returns a shortfalls array naming each part and
  the amount missing; the toast says only "There is not enough on hand for that issue."
- **A freshly generated report shows `—` for BY** *(Fixed: both write routes re-select through the list
  query; re-run shows "Adaeze Okeke" with no reload.)* until the page is reloaded: `POST /reports` and
  `/generate` return the raw row without the `created_by_profile` join.
- **Not fixed — the asset register has no column sorting**, and its header sentence mixes scopes
  ("1 asset · 4 locations · 5 sites" — the first filtered, the other two not).

## What was not run

**One card: keyboard activation (card 17).** Focus visibility and tab order were observed and are fine —
15 stops, every one with a visible ring, DOM order — and Shift+Tab reaches the primary button. But
Return and space on that focused button did nothing, exactly as round 2 found for Enter-to-submit. This
pane's synthetic keys move focus and type text but do not appear to produce the browser's own
key-to-activation behaviour, so neither a pass nor a fail can be claimed. **A human with a real keyboard
settles it in thirty seconds.**

Also still not run, from earlier rounds: CSV import itself and photo upload (both need a native file
picker), and the cross-scope half of file authorisation (nothing has ever been uploaded to this
instance).

## Demo accounts

Unchanged from round 2. All still enabled.

| Role | Email | Password |
|---|---|---|
| System Admin (owner) | `a.okeke@ngml.example` | `Password123!` |
| Operations Manager | `uat.ops@assetcore.test` | `UatPass123!` |
| Maintenance Engineer | `uat.eng@assetcore.test` | `UatPass123!` |
| Field Technician | `uat.tech@assetcore.test` | `UatPass123!` |
| HSE / Compliance Officer | `uat.hse@assetcore.test` | `UatPass123!` |
| Auditor | `uat.auditor@assetcore.test` | `UatPass123!` |
| Executive / Viewer | `uat.viewer@assetcore.test` | `UatPass123!` |
| *(orphaned, pre-existing)* | `paul.o@ngml.com` | `NgmlDemo2026` |

## State of `assetcore_integrate` after this round

**Changed by testing, and left in place:**

- `WO-2025-0041` is now **Closed**, and its reserved `SP-PT-1100` line is **consumed** — stock fell
  2 → 1 with a movement row "Used on job · WO-2025-0041". This was the test.
- `WO-2025-0042` now carries an **estimated cost of ₦25,000** and a **pending `wo_cost` approval**
  raised by the Operations Manager (used for the self-approval check). Its 50× over-reservation was
  deleted after the refusal was recorded.
- `WO-2026-0003` "UAT R3 — double submit probe" exists, status New, unassigned — the double-submit test.
- `NGML-MTR-0042`'s **manufacturer is set to "UAT R3 Instruments"** (in `specs`), from the health
  regression test.
- Compliance audit `AUD-2026-0001` has a **second finding**, critical, "UAT R3 - flare stack emissions
  monitoring log not signed off for August.", due 15 Oct 2026.
- Risk **`RSK-2026-0002`** "UAT R3 — inlet flange gas release during changeover", now at likelihood 1 ×
  consequence 5 = 5 (Low) after being edited down from 20 to prove the band moves.
- One report row, "Asset Register — 8 Sept 2026", CSV, and its file under
  `apps/api/data/files/<org>/reports/`.

**Restored deliberately:** the approval band `UAT band — job spend ₦1,000 to ₦50,000` was edited to a
₦75,000 ceiling and **set back to ₦50,000**.

**Added by the re-runs after the fixes:** a second report row, "Work Order Summary — 8 Sept 2026" (XLSX),
and its file alongside the first.

**Still outstanding from round 2, unchanged:** the fabricated ₦45,000,000 depreciation schedule on
`NGML-CMP-0017` (nothing posted — supersede or delete it before anyone reads the register as real), the
still-active escalation rule, and the enabled demo members.


## What changed in the code

| Area | Files |
|---|---|
| QR labels wired to the register | `apps/app/src/pages/Assets.jsx` |
| CSV template example row + length assertion | `apps/app/src/pages/Assets.jsx` |
| Approval band validated on update | `apps/api/src/routes/approvals.ts` |
| Report create gated, refusal surfaced | `apps/app/src/pages/Reports.jsx` |
| Report rows carry their requester | `apps/api/src/routes/reports.ts` |
| Theme persisted, system default | `apps/app/src/App.jsx` |
| Dark brand ramp, `--b-solid`, muted-text steps | `packages/ui/index.css`, `Topbar.jsx`, `Sidebar.jsx`, `Dashboard.jsx`, `Maintenance.jsx`, `Approvals.jsx`, `Admin.jsx` |
| Scan card reads `specs` as well as columns | `apps/app/src/pages/Scan.jsx` |
| Risk pickers load independently | `apps/app/src/pages/Risks.jsx` |
| Stock shortfall detail surfaced | `apps/app/src/lib/apiClient.js`, `apps/app/src/pages/WorkOrders.jsx` |
| Regression tests (8) | `apps/api/test/uatRound3.test.ts` |

## Should this merge to main?

**Yes.** Six defects closed, four of them user-facing on the normal path (an unreachable feature, a
template that corrupts imports, a 500 where a sentence belonged, and a silent refusal), plus five smaller
ones found in passing. The API suite went 192 → 200 with nothing skipped, and every fix was watched
working in a browser as the role its card names.

**With three things understood:**

1. **The dark-theme colour change is the broadest edit here.** It inverts the brand ramp under
   `[data-theme=dark]` and touches seven components. Dashboard and Analytics were re-measured at 0 failures;
   the other screens were not measured individually, only viewed.
2. **Light-mode muted text is still at 2.67:1** and was deliberately not touched. It is the single largest
   remaining accessibility item and it needs a design decision, not a patch.
3. **Keyboard activation is still unproven** — the one card in this round a human has to run.
