# 05c Refactor opportunities: tenant web app (apps/app), packages/ui, packages/rbac

Baseline: commit 913e934 on main. Read-only audit; nothing in source was changed.
Severity: MEDIUM = maintainability issue causing or likely to cause bugs; LOW = cleanliness; IDEA = optional.
Effort: S under 1h, M 1-3h, L own session.



## Summary in plain words

The app works, but almost everything is written out by hand on each page: every page fetches its own data with its own loading and error flags, draws its own modal backdrop, styles its own labels and table cells inline (2,855 `style={{...}}` blocks against 632 `className=`), and keeps its own copy of small helpers like `fmtDate` (7 identical copies) and `Stat` (5 copies). That is not a style complaint: the copies have already drifted. Some pages ignore per-user capability grants because they call `can(roleKey, cap)` without `extraCaps`; two money formatters print a hardcoded naira sign in an app whose currency is configurable; "today" is computed in UTC in 7 places and in local time in 2; a low-priority job is green in the asset panel and grey on the Work Orders page. A few save paths swallow their errors, so a user can click Save and see nothing happen.

The shared pieces already exist in embryo (`StatusBadge`, `lib/errors.js`, `lib/money.jsx`, `lib/health.js`, `.modal-overlay`/`.modal-card`/`.label` CSS classes), they are just not used consistently. The cheapest high-value move is to finish those, not to invent new architecture. File splits come last and only for the files that are edited often (Assets.jsx 29 commits, Admin.jsx 18, WorkOrders.jsx 15, Maintenance.jsx 15).

Nothing should be refactored before a linter exists: with no types, no tests and no ESLint, a moved helper that is no longer imported fails only at runtime on the page that uses it.

---

## A. Contexts, routing and permission checks

### RF-FE-01 `can()` called without `extraCaps` in 13 places (MEDIUM, and a bug)

Plain: per-user capability grants (Admin > Access) are ignored on five pages, so a person granted, say, `risk:create` on top of their role never sees the New Risk button, although the API would accept it. This is the kind of drift a single hook prevents.

Evidence (baseline 913e934): `pages/Risks.jsx:342-343`, `pages/Defects.jsx:308-312`, `pages/SpareParts.jsx:239-241`, `pages/Approvals.jsx:422-423`, `pages/Depreciation.jsx:354`. All other 49 call sites pass `extraCaps`. Of the 13, 11 check caps that are in `GRANTABLE_CAPS` (`packages/rbac/index.js:146`), so the gap is reachable today; `depreciation:manage` and `approval:manage` are not grantable, so those two are latent only.

Target shape: add to `lib/AuthContext.jsx`

```
export function useCan() {
  const { roleKey, extraCaps } = useAuth()
  return useCallback((cap) => can(roleKey, cap, extraCaps), [roleKey, extraCaps])
}
// page:   const can = useCan();  const canCreate = can('risk:create')
```

and migrate all 62 page/component call sites (grep `\bcan(`). Then `lib/rbac.js` only needs to re-export `can` for App.jsx and Sidebar, or those also switch to the hook. Effort S-M (mechanical, 18 files). Risk low once ESLint `no-undef` is on.

### RF-FE-02 Route permissions defined twice: App.jsx and Sidebar.jsx (MEDIUM)

Plain: which capability a page needs is written once in the router and again in the sidebar nav list. They already disagree for `/inspections` (sidebar requires `inspection:read`, route has no check) and both omit a check for `/compliance` although `supervisor` and `officer` lack `compliance:read` (see Bugs).

Evidence: `App.jsx:136-156` (inline `can(...) ? <Page/> : <Navigate/>` per route, 8 calls); `components/Sidebar.jsx:37-66` (`OPERATIONS`, `INTEGRITY` arrays with `cap` / `anyCap`); admin entry duplicated at `App.jsx:156` and `Sidebar.jsx:74`.

Target shape: one `src/routes.js` table `{ key, path, label, icon, cap?, anyCap?, soon?, section, element }`. App.jsx maps it to `<Route element={<Gate need={r}>{r.element}</Gate>} />`; Sidebar filters the same table by `section`. Gate collapses the repeated `gate(can(...) ? X : <Navigate/>)` into one component. Effort M. Risk low-medium (route order and the `ComingSoon` props need care). Depends on RF-FE-01 (useCan).

### RF-FE-03 Theme passed as props through every page (LOW)

Plain: `dark` and `toggleDark` are drilled from App.jsx into all 23 pages only so each page can hand them to `<Topbar>`.

Evidence: `App.jsx:120` (`const props = { dark, toggleDark }`, spread on 23 routes); `dark={dark} toggleDark={toggleDark}` appears 23 times in pages.

Target shape: `lib/ThemeContext.jsx` holding the `preferredTheme`/`applyTheme` code now at `App.jsx:70-103`; Topbar reads it. Pages lose two props each. Pairs naturally with RF-FE-15 (`<PageShell>`). Effort S. Risk low.

### RF-FE-04 Context value objects re-created on every provider render (LOW)

Plain: four providers build a fresh `value={{...}}` each render, so every consumer re-renders whenever the provider does, even when nothing it reads changed. The visible cost: every `useToast()` consumer (28 components, including whole pages like Assets) re-renders each time any toast appears or disappears, because `ToastProvider` re-renders on every push and wraps the stable `toast` in a new object.

Evidence: `lib/ToastContext.jsx:34` (`value={{ toast }}`; the inner `toast` is already stable via `useRef` at :27); `lib/NotificationsContext.jsx:65` (new value every 30 s poll, `POLL_MS` :6, plus on every window focus :32); `lib/LocationFilterContext.jsx:50`; `lib/SidebarContext.jsx:26`; `lib/AuthContext.jsx:66-82` (also `extraCaps ?? []` at :73 makes a new array each render, which defeats any `useMemo`/`useCallback` keyed on it, including the proposed `useCan`).

Target shape: `useMemo` each value; in AuthContext memoise `extraCaps` (`const EMPTY = []` module constant). For Toast, split into a toast-API context (stable) and keep the list state local to the provider. Effort S. Risk low.

### RF-FE-05 AuthContext org/sites load has no error path (LOW, borderline bug)

Evidence: `lib/AuthContext.jsx:54-60`: `Promise.all([api.get('/org'), api.get('/sites')]).then(...)` with no `.catch`. A failure leaves `org` null (so `useMoney` falls back to NGN silently) and logs an unhandled rejection. Also `getSession().then(...)` at :26 has no catch, so a thrown session fetch would leave `loading` true forever (Splash never clears). Fix inside the same refactor as RF-FE-04. Effort S.

### RF-FE-06 Notification polling duplicates the dashboard-stats fetch in Sidebar (IDEA)

Evidence: `components/Sidebar.jsx:85` calls `getDashboardStats()` on every mount (every page navigation, since each page renders its own Sidebar) just to show the open-WO count; NotificationsContext already polls. Either move the open-WO count into a small context polled alongside notifications, or accept it. Effort S.

## B. API layer (lib/apiClient.js, lib/db/*.js)

### RF-FE-07 Five hand-written fetch wrappers that disagree on retry and errors (MEDIUM)

Plain: there are five places that call `fetch` with the bearer token, and each handles the expired-token retry and the error shape differently. A download or an inline image whose token expired fails outright instead of refreshing, and its error loses the API's code, so `errorText()` cannot explain it.

Evidence:
| Wrapper | 401 refresh + retry | `err.code` | `err.shortfalls` | 204 handled |
|---|---|---|---|---|
| `request` `lib/apiClient.js:58` | yes (skips `/auth/refresh`) | yes | yes | yes |
| `upload` `:95` | yes (no refresh-path guard) | yes | no | no |
| `download` `:124` | no | no (message only) | no | n/a |
| `blobUrl` `:144` | no | no | no | n/a |
| `downloadExport` `lib/db/exports.js:17` | yes, own copy | yes, own copy | no | n/a |

`exports.js:11-15` documents exactly why it exists: `api.download` "drops the server's error code ... and never retries after a token refresh". `exports.js:3` also re-declares `BASE`. `download` revokes the object URL in the same tick (`:138`) while `exports.js:50-51` notes that this "can cancel the save in Firefox and Safari" and delays it; the two download paths behave differently.

Target shape: one private `send(method, path, { body, formData, as = 'json' })` that does auth header, 401-refresh-retry, and `toApiError(res, payload)`; `request`, `upload`, `download` and `blobUrl` become 3-line callers. `download` adopts the content-disposition filename and delayed revoke from `exports.js`; `downloadExport` becomes `api.download(url, fallbackName)` returning the headers it needs. Effort M. Risk medium (auth path): verify sign-in, an expired-token page load, a photo upload, a document view, and one export.

### RF-FE-08 Pages that call `api.*` directly (LOW)

Plain: `lib/db/assets.js:3-5` says components "never inline fetch calls", but 12 files do. Most are auth flows (fine to leave or move to `lib/auth.js`); the org/profile ones duplicate helpers that already exist.

Evidence: `pages/Settings.jsx:42,50,62,236,348` (`/profile`, `/auth/change-password`, two `PATCH /org` that duplicate `updateOrg` in `lib/db/org.js:9`); `pages/Onboarding.jsx:128` (`PATCH /org`, again `updateOrg`); `pages/ForcePasswordChange.jsx:30` and `Settings.jsx:62` (same change-password call twice); `pages/ForgotPassword.jsx:24`, `pages/ResetPassword.jsx:33`; `lib/AuthContext.jsx:43,54` (`/org`, `/sites` though `getOrg` and `listSites` exist). File-serving calls (`api.download`/`api.blobUrl` in `AuthImage`, `ImageLightbox`, `DocumentsPanel`, `InspectionsPanel`, `CompliancePanel` x4, `Assets`, `WorkOrders`) build `/files/${rel}` paths by hand: one `lib/db/files.js` with `fileUrl(rel)`, `downloadFile(rel, name)` removes that.

Target shape: `lib/db/profile.js` (`getProfile`, `updateProfile`), `changePassword`/`forgotPassword`/`resetPassword` in `lib/auth.js`, `lib/db/files.js`. Effort S. Risk low.

### RF-FE-09 Query strings built three ways (LOW)

Evidence: `URLSearchParams` in 12 db modules (e.g. `lib/db/assets.js:8-13`); hand-concatenated `?x=${...}` in `analytics.js:16,24,34`, `devices.js:4,21`, `escalations.js:36`, `notifications.js:4`, `pmSchedules.js:4`, `risks.js:68`; a third local helper in `dashboard.js:4` and `integrity.js:15` / `complianceLicences.js:4` for `location_id`. Some hand-built ones skip `encodeURIComponent` (`analytics.js:34` dates, `devices.js:4` statuses joined with commas). Parameter naming also mixes `location_id` with `activeOnly` (`pmSchedules.js:4`) and `include_superseded` (`depreciation.js`), which mirrors the API so is not the frontend's to fix alone.

Target shape: `qs(obj)` in `apiClient.js` that drops empty/`'all'` values and encodes; `api.get('/assets', { status, location_id })`. Effort S. Risk low.

Naming note (IDEA, no action): delete helpers use `softDelete*` (8), `delete*` (7), `archive*` (3), `retire*` (4) for what is in every case `api.del`. The verbs track UI copy, which is defensible; just pick one rule when touching them.

---

## C. Errors, toasts and swallowed failures

How errors reach the user today: `errorText(err, fallback)` (`lib/errors.js:112`) is used 126 times, which is good. But the delivery channel is a mix: inline `setErr` state (68 error states across pages), `toast.error` (32), and `alert()` (16, all in Admin, WorkOrders, Depreciation, SpareParts, ImageLightbox, InspectionsPanel). `confirm()` is used 14 times for destructive actions.

### RF-FE-10 Swallowed errors on save paths (MEDIUM, list)

These are the ones that matter, because the user acted and was not told it failed:

| Where | What happens |
|---|---|
| `pages/Integrations.jsx:116` `save()` | `catch { /* non-fatal */ }`: Save on an integration config fails silently; button just re-enables. |
| `pages/Notifications.jsx:123` `togglePref` | Optimistic toggle, `catch { /* ignore */ }`: UI shows the new preference, server kept the old one. No rollback. |
| `pages/Assets.jsx:397-398` create asset | Photo and document uploads after create are each `catch { /* keep going */ }`: the toast says "Asset created." and the files that failed are just missing. Should at least count failures and say "Asset created; 2 files could not be attached." |
| `lib/NotificationsContext.jsx:45,53,61` markRead / markUnread / markAllRead | Ignored; state is not updated on failure so the UI stays honest, but the click looks dead. LOW. |

Load-path swallows (LOW, but one has a save consequence):
- `pages/Settings.jsx:42-44` `api.get('/profile').catch(() => {})`: if the load fails the form shows blanks, and pressing Save then writes `full_name: ''` (`:50`). Treat as MEDIUM.
- `pages/Integrations.jsx:213`, `components/SendForApproval.jsx:88`, `pages/Defects.jsx:237`, `pages/WorkOrders.jsx:409`, `pages/Admin.jsx:1034`, `pages/Assets.jsx:717-718`, `pages/Export.jsx:26-27`, `pages/Dashboard.jsx:136`, `components/LicenceBanner.jsx:19`, `components/Sidebar.jsx:85`: sections silently empty on failure. Acceptable for decorative counts; for `Export.jsx:26-27` an empty location/site filter list looks like "you have none".

Target: covered by `useResource` (RF-FE-13) which always exposes `error`, and by a rule: a `catch` on a user action must call `toast.error(errorText(e, ...))` or set visible error text. Effort S for the four save paths. Risk low.

### RF-FE-11 Code-to-sentence special cases that duplicate `ERROR_MESSAGES` (LOW, drift risk)

Plain: 17 places still test `e.message === 'some_code'` and type out a sentence, many of which are word-for-word the entry in `lib/errors.js`. If the copy in errors.js is improved, these do not follow.

Evidence, identical to `ERROR_MESSAGES` (delete the ternary, keep `errorText(e, fallback)`): `pages/Approvals.jsx:227` (`invalid_band`), `pages/SpareParts.jsx:94` (`duplicate_part_number`), `:170` (`insufficient_stock`), `pages/WorkOrders.jsx:521` (`already_consumed`), `components/CompliancePanel.jsx:453` (`outcome_required`).
Context-specific overrides (legitimately different wording; move into an `overrides` arg so the shape is uniform): `components/InspectionsPanel.jsx:239`, `components/CompliancePanel.jsx:299`, `components/DocumentsPanel.jsx:69`, `pages/Admin.jsx:1405`, `pages/Risks.jsx:204`, `pages/Settings.jsx:249`, `pages/Depreciation.jsx:67-71,374`, `pages/Defects.jsx:192,255-257`, `pages/SpareParts.jsx:262`. Also `lib/db/approvals.js:68` exports its own `DIRECT_ERROR_TEXT` map, a second error table.

Target shape: `errorText(err, fallback, overrides = {})` checking `overrides[code]` first; call sites become `errorText(ex, 'Save failed.', { forbidden: 'Your role cannot see the parts store.' })`. Compare on `err.code`, not `err.message` (they are equal today only because `apiClient.js:80` copies the code into the message). Effort S. Risk low.

### RF-FE-12 `alert()` / `confirm()` for errors and destructive actions (LOW)

Evidence: 16 `alert(` (13 of them `alert(errorText(e))`, e.g. `pages/WorkOrders.jsx:330,338,344,515`, `pages/Admin.jsx:329,465,565`, `pages/Depreciation.jsx:392,403,410`, `pages/SpareParts.jsx:280`); `pages/Depreciation.jsx:402` uses `alert` for a success message. 14 `confirm(` calls. A `ToastContext` already exists, so `alert(errorText(e))` -> `toast.error(errorText(e))` is a one-line change each. For confirms, a `useConfirm()` returning a promise over a small `<ConfirmDialog>` keeps call sites identical in shape (`if (!(await confirm('Archive this part?'))) return`) and is themable and phone-friendly. Effort S (alerts), M (confirm dialog). Risk low. Note: the behaviour change from blocking `alert` to non-blocking toast is visible; the owner should agree.

---

## D. Repeated patterns that want one shared primitive

Counts are from grep over `apps/app/src` at baseline.

| Pattern | Count | Existing shared piece | Adoption |
|---|---|---|---|
| `const [loading, setLoading]` | 28 | none | 0 |
| error state (`err`/`error`/`loadErr`) | 68 | `errorText` | partial |
| saving/busy/submitting state | 50 | none | 0 |
| `useEffect(() => { load() }, [load])` | 26 | none | 0 |
| stale-response guards (`let cancelled`) | 12 of 84 `useEffect`s | none | 0 |
| modal components (`function *Modal`) | 33 | `.modal-overlay` / `.modal-card` CSS (`packages/ui/index.css:454-469`) | **0 uses** |
| inline backdrop `rgba(0,0,0,.4)` | 28 | same | 0 |
| modals with an Escape handler | 0 of 33 (only ImageLightbox, Sidebar, Topbar listen) | none | |
| page shell (`app-shell` + Sidebar + flex column + Topbar) | 23 pages | none | 0 |
| `Stat` stat-strip cell | 5 copies (4 byte-identical) | none | |
| `Field` label+control wrapper | 3 copies (`Assets.jsx:210`, `Scan.jsx:25`, `TransferAssetsModal.jsx:17`) plus `F` in SpareParts | `.label` class | 44 uses vs ~45 inline label styles |
| `EmptyState` | 2 (`CompliancePanel.jsx:919`, `Devices.jsx:287`) + `EmptyPM` + `EmptyChart` | none | |
| inline "Loading..." / empty cells (`padding:48/32,textAlign:'center'`) | 42 | none | |
| `confirm()` before destructive action | 14 | none | |
| form `useState(form)` + `setForm(f => ({...f, [k]: v}))` | 24 forms, 28 inline setters, 8 `set(k,v)` helpers | none | |
| hand-rolled input style objects (`inp`, `lbl`, `sel`, `inputStyle`) | 28 | `.input`, `.label` | 128 `.input` uses |

### RF-FE-13 `useResource` / `useAsync` hook for loading, error, data and stale responses (MEDIUM)

Plain: every page writes the same 12 lines to fetch data. Only 12 of 84 effects guard against a slow earlier response landing after a newer one, so changing a filter or the location switcher quickly can show the older result (`pages/Integrity.jsx:62-65`, `pages/SpareParts.jsx:254-268` with `filters` in deps, `pages/Assets.jsx:1371-1384`, `pages/WorkOrders.jsx:~875`, `pages/Maintenance.jsx:~165`). A hook fixes that in one place.

Target shape, `lib/useResource.js`:

```
export function useResource(fetcher, deps, { initial = null, errorFallback } = {}) {
  // returns { data, loading, error, reload, setData }
  // ignores responses whose request id is older than the latest
  // error is already errorText(e, errorFallback)
}
```

Before (`pages/Depreciation.jsx:356-380`, 25 lines):
```
const [schedules, setSchedules] = useState([]); const [stats, setStats] = useState(null)
const [forecast, setForecast] = useState([]); const [loading, setLoading] = useState(true)
const [error, setError] = useState(null)
const load = useCallback(async () => { setLoading(true); setError(null); try { ... } catch ... finally ... }, [])
useEffect(() => { load() }, [load])
```
After:
```
const { data, loading, error, reload } = useResource(
  () => Promise.all([listSchedules(), getDepreciationStats(), getForecast()]), [],
  { errorFallback: 'Failed to load.', overrides: { forbidden: 'Your role cannot see the depreciation register.' } })
const [schedules = [], stats, forecast = []] = data || []
```
Before (`pages/Integrity.jsx:62-65`, no stale guard): `useEffect(() => { setData(null); getIntegrityOverview({ locationId }).then(setData).catch(...) }, [locationId])`
After: `const { data, error } = useResource(() => getIntegrityOverview({ locationId }), [locationId])`

Before (side lookups, 7 copies of `listAssets().then(setAssets).catch(() => setAssets([]))`, e.g. `Depreciation.jsx:381`, `SpareParts.jsx:270`):
After: `const { data: assets = [] } = useResource(listAssets, [])`. A tiny in-memory cache keyed by fetcher for `listSites`/`listAssets`/`listOrgUsers` (fetched by 13 files) is an optional second step, not part of this refactor.

Do not reach for react-query: the app is small, the API is same-origin, and one 40-line hook covers every call site found. Effort M to write and adopt on 3 pages, then S per page. Risk low per page (behaviour-preserving if `loading` starts `true` as today).

### RF-FE-14 `<Modal>` component on top of the unused `.modal-overlay` / `.modal-card` classes (MEDIUM)

Plain: 33 modals each paint their own backdrop, z-index, width, radius, shadow and footer. The mobile pass (01b159e) added `.modal-overlay`/`.modal-card` with a 92vw cap, but nothing uses them, and 8 modals still have a fixed width and no `maxWidth` (they fit a phone only because a flex child can shrink): `pages/Risks.jsx:226`, `Depreciation.jsx:90`, `Approvals.jsx:235`, `SpareParts.jsx:109,178`, `Defects.jsx:107,200`, `components/AssetQr.jsx:49`. z-index values for overlays are 200 (18x), 1000 (7x), 1100 (9x), 2000 (3x, toasts) with no scale, so stacking a modal over a detail panel works by accident.

Target shape, `components/Modal.jsx`:
```
<Modal title="Raise a work order" width={460} onClose={onClose}
       footer={<ModalActions onCancel={onClose} submitLabel="Raise job" busy={busy} />}
       as="form" onSubmit={submit}>
  ...fields...
  <FormError>{err}</FormError>
</Modal>
```
Modal renders `.modal-overlay` + backdrop + `.modal-card` (via `--modal-w`), closes on Escape and backdrop click, traps initial focus, and uses one z-index token (`--z-modal`). Before/after for `pages/Defects.jsx:197-221` (`RaiseModal` render): 25 lines with 9 inline style objects becomes about 10 lines with none. Effort M for the component plus 3 pilot modals; then S each (33 total). Risk low; visible change is only Escape-to-close and consistent radius (8 vs 10 today).

### RF-FE-15 `<PageShell>` or a layout route (LOW, high leverage)

Plain: all 23 pages open with the same five lines (`app-shell`, `<Sidebar active>`, the flex column with an inline style repeated 25 times, `<Topbar breadcrumb dark toggleDark>`).

Evidence: e.g. `pages/Inspections.jsx:15-23`, `pages/Compliance.jsx:15-21`; inline style `flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'` x25.

Target shape: either `<PageShell active="inspections" breadcrumb="Inspections">{...}</PageShell>`, or a react-router layout route (`<Route element={<AppLayout/>}>` with `<Outlet/>`) that keeps Sidebar mounted across navigation. The layout route is cleaner but changes when Sidebar's open-WO count refreshes (`Sidebar.jsx:79-87` relies on remounting), so start with `<PageShell>`. Combine with RF-FE-03 (ThemeContext) so pages stop taking `dark`/`toggleDark`. Effort S-M. Risk low.

### RF-FE-16 Form primitives: `<Field>`, `<FormError>`, `useForm` (LOW)

Evidence: label styles exist in four variants: `.label` class (weight 500, `--n700`, mb 5; 44 uses, 17 of them in Risks with a redundant `style={{display:'block',marginBottom:5}}`), inline weight 600 (`WorkOrders.jsx` x17, `Assets.jsx` x3, `Onboarding.jsx` x3, `TransferAssetsModal.jsx:20`), flex-column labels in `CompliancePanel.jsx:107,458`, `Devices.jsx:78`, `InspectionsPanel.jsx:91`, `Admin.jsx:1412`, and `Settings.jsx:70,254,355` (mb 4). Hand-rolled input style objects (28, listed in the table) bypass `.input`, so those inputs get no focus ring (`.input:focus`, `packages/ui/index.css:225`). `.input` already sets `width:100%`, so the 49 `style={{width:'100%'}}` and the three `inputProps = { className:'input', style:{ width:'100%' } }` (`Assets.jsx:337,627,713`) are redundant.

Target shape: `components/form.jsx` exporting `Field({ label, required, hint, full, children })`, `FormError`, and `useForm(initial)` returning `{ form, set, setForm }` where `set(k)` is an `onChange` handler. Add `.input-sm` (34px, 13px) to the CSS since most in-modal inputs are 34-36px, not the 40px `.input` default. Effort M. Risk low (visual: label weight unifies on one value, owner should pick 500 or 600).

### RF-FE-17 `<Stat>`, `<EmptyState>`, `<LoadingRow>` (LOW)

Evidence: `Stat` at `pages/Approvals.jsx:27`, `Defects.jsx:42`, `Risks.jsx:330`, `SpareParts.jsx:38` (identical) and `Depreciation.jsx:24` (adds `hint`, font 19 vs 20). `EmptyState` at `CompliancePanel.jsx:919` and `Devices.jsx:287`, `EmptyPM` at `Maintenance.jsx:621`, `EmptyChart` at `Charts.jsx:21`. 42 inline centered "Loading..." / "No ..." blocks.
Target: `components/Stat.jsx` (with optional `hint`), `components/EmptyState.jsx({ title, body, action })`, and `<TableState loading error empty colSpan>` for table bodies. Effort S. Risk low.

A generic `<DataTable>` is NOT recommended yet: the 24 tables differ in selection, sticky offsets and the mobile card-list twin (`Assets.jsx` ~1564-1640). Extract shared `th`/`td` classes (see F) and revisit after the splits.

Related: `pages/WorkOrders.jsx:874-885` and `pages/Maintenance.jsx:164-182` re-fetch sites, assets and users every time a status filter or the "show completed" toggle changes, because the side lookups share one `load()` with the filtered list. Splitting them into separate `useResource` calls removes 3 of 4 requests per filter click.

---

## E. Duplicated constants, maps and formatting helpers

### RF-FE-18 Two notions of "today": UTC in 7 places, local in 2 (MEDIUM, and a bug window)

Plain: `new Date().toISOString().slice(0,10)` is the UTC date. In Lagos (UTC+1) between 00:00 and 01:00 it is still yesterday, so a default "completed on" date, an overdue check or a week view is a day off for that hour. Someone already noticed and fixed it twice with `toLocaleDateString('en-CA')`, but the fix did not spread.

Evidence, UTC: `components/InspectionsPanel.jsx:63`, `components/CompliancePanel.jsx:396`, `pages/Dashboard.jsx:138`, `pages/Maintenance.jsx:35-36` (`isoToday`, `addDays`) and `:161-162`, `:345`, `pages/Calendar.jsx:28` (`iso`), `pages/Defects.jsx:56` (`identified_date` default, evaluated once at module load, so it is also stale if the tab stays open past midnight). 14 `toISOString().slice(0, 10)` in all.
Local (correct): `pages/Assets.jsx:693` `localDateStr`, `components/TransferAssetsModal.jsx:13` `todayLocal`.

Target shape: `lib/dates.js` with `todayISO()`, `addDaysISO(iso, n)`, `fmtDate(d)`, `fmtDateLong(d)`, `fmtDateTime(ts)`, `fmtShortDate(d)` (all `en-GB`, local). Effort S. Risk low, but `Calendar.jsx` mixes `T00:00:00Z` UTC parsing in the month grid on purpose; migrate it last and check a month boundary.

### RF-FE-19 `fmtDate` and friends copied 7+ times (LOW)

Evidence: byte-identical `fmtDate` (`'en-GB', { day:'numeric', month:'short', year:'2-digit' }`) at `components/InspectionsPanel.jsx:49`, `components/CompliancePanel.jsx:41`, `pages/Risks.jsx:20`, `pages/Integrity.jsx:13`, `pages/Maintenance.jsx:31`, `pages/Defects.jsx:26`, `pages/Assets.jsx:188`; a different-format `fmtDate` at `pages/Settings.jsx:130` (`year:'numeric'`); `fmtWhen` at `pages/Approvals.jsx:22` and `components/SendForApproval.jsx:56` (identical except the empty value: a dash placeholder vs an empty string); `fmtDateTime` at `pages/Assets.jsx:193`. 24 `toLocaleDateString` calls with 14 distinct option sets. Target: `lib/dates.js` above. Effort S. Risk low.

### RF-FE-20 Money formatted with a hardcoded naira sign in an app whose currency is configurable (MEDIUM)

Plain: `lib/money.jsx` exists precisely so currency comes from the organisation (its header explains the ₦/$ bug it fixed). Two local formatters skip it, so an org on USD still sees ₦ on work-order costs and the depreciation preview.

Evidence: `pages/WorkOrders.jsx:38-43` `fmtNaira` (used at `:711` detail Cost and `:1030` board card) although the same file already calls `useMoney()` at `:399` and `:497`; `pages/Depreciation.jsx:19-22` `exact()` (used 9 times, `:158-181`, `:320-324`) although the file imports `useMoney, Money` at `:12`. Field labels hardcode "(₦)": `WorkOrders.jsx:156,284`, `Assets.jsx:505,531`, `SpareParts.jsx:122,204`, `Depreciation.jsx:136`, plus the placeholder at `Approvals.jsx:246`.

Target: replace `fmtNaira` with `money()` and `exact` with `moneyFull()`; labels use `currencySymbol(base)` from `useMoney()`. Effort S. Risk low. (The labels are arguably a UX fix; include them because they are the same drift.)

### RF-FE-21 Status / priority maps duplicated, and already drifting (MEDIUM)

| Concept | Copies | Drift |
|---|---|---|
| WO priority colour | `lib/db/workOrders.js:32` `WO_PRIORITY_STYLE` (low = grey `--n600`, medium = blue `--b700`); `pages/Assets.jsx:901` `PRIORITY_C` (low = green `--sgt`, medium = grey `--n600`); `pages/Analytics.jsx:21` `PRIORITY_COLOR` (chart solids, low `--n300`, medium `--b500`); `pages/Maintenance.jsx:29` `PRIORITY_COLOR` (unused, ESLint flags it) | **Yes**: a low-priority job is green in the asset panel and grey on the Work Orders page and Dashboard. |
| WO status / type / priority labels | `lib/db/workOrders.js:16,26,27`; `pages/Analytics.jsx:16-22` | **Yes**: "In progress" / "Awaiting parts" (Analytics) vs "In Progress" / "Awaiting Parts" (everywhere else). |
| PM task status | `pages/Maintenance.jsx:21` `TASK_STATUS`; `pages/Assets.jsx:899` `PM_STATUS_C` | Colours agree; labels only in one. Duplicate. |
| Inspection status | `components/InspectionsPanel.jsx:34` `STATUS_META` (exported, never imported elsewhere); `pages/Assets.jsx:900` `INSP_STATUS_C` | Agree today. Duplicate. |
| Asset status | `pages/Assets.jsx:41` `STATUS_STYLE`; `components/AssetMap.jsx:29` `STATUS_COLOR`; `pages/Scan.jsx:12` `STATUS_CLASS` | Three vocabularies (tone object, solid colour, badge class). |
| Criticality | `components/AssetMap.jsx:38`; `pages/Scan.jsx:11`; inline list `pages/Admin.jsx:1454` | Duplicate. |
| Entity type label / route | `lib/notificationLink.js:13,23`; `pages/Calendar.jsx:16`; `pages/Dashboard.jsx:22`; `lib/db/approvals.js:3`; `lib/db/escalations.js:3`; `lib/auditLabels.js:133` (underscore-to-space fallback) | Labels agree where they overlap; four places to add a new entity. |
| "In progress" casing across domains | Defects, Audits: "In progress"; WOs, Inspections, PM: "In Progress" | Copy inconsistency. |
| Role labels | `packages/rbac` `ROLE_LABELS`; `pages/Admin.jsx:607` `ROLES_LIST` re-types every label plus a hand-written `perms` summary | Agree today; the `perms` prose can drift from `ROLE_CAPABILITIES` silently. |
| Initials | `lib/AuthContext.jsx:7` `initialsOf`; `pages/Admin.jsx:684` `initials` | Byte-identical copy. |
| Status-pill rendering | `components/StatusBadge.jsx` (tone objects), `.badge-*` CSS classes (22 uses, e.g. Scan, Defects, Risks, CompliancePanel audits), local `Pill` (`Integrity.jsx:18`), `BandBadge` (`Risks.jsx:25`), `PriorityBadge`/`TypeBadge` (`WorkOrders.jsx:29,34`), and a second component also named `StatusBadge` (`pages/Integrations.jsx:72`) | Two pill systems (inline tone vs class). |

Target shape: `src/lib/domain/` (or one `lib/domain.js` to start) holding, per entity, `{ key, label, tone }` where `tone` is one of `good | warn | bad | info | neutral | draft`, and one `<StatusBadge tone="warn">` that maps tone to the existing `.badge-g/-a/-r/-b/-n` classes. Pages import `WO_STATUS`, `WO_PRIORITY`, `PM_STATUS`, `INSPECTION_STATUS`, `ASSET_STATUS`, `CRITICALITY`, `ENTITY` from there. Chart solids derive from tone (`good -> var(--sg)`), so Analytics stops keeping its own. Move `ROLES_LIST` descriptions into `packages/rbac` as `ROLE_DESCRIPTIONS`; delete `Admin.jsx:684`. Effort M. Risk low-medium (visible: the low-priority colour has to be decided once; owner picks).

### RF-FE-22 Enum key lists: frontend and API copies (LOW today, MEDIUM over time)

Plain: the API exports its allowed values as `export const X = [...] as const` in route files; the frontend keeps its own `[key, label, hint]` tuples in `lib/db/*.js`. They match today. Nothing checks that they keep matching, which is the exact problem `packages/rbac` was created to solve for capabilities (`packages/rbac/index.js:4-10`).

| List | API | Frontend | Match at 913e934 |
|---|---|---|---|
| Defect severities / statuses / open statuses | `routes/defects.ts:17-19` | `lib/db/defects.js:6,15,26` | yes |
| Risk categories / statuses | `routes/risks.ts:16-17` | `lib/db/risks.js:3,12` | yes |
| Escalation entity types / triggers / valid pairs | `routes/escalations.ts:16-19` + VALID_TRIGGERS | `lib/db/escalations.js:3,15` (comment says "Mirrors") | yes |
| Approval entity types / kinds | `routes/approvals.ts:23,27` | `lib/db/approvals.js:3,16` | yes |
| Audit outcomes / finding severities | `routes/compliance.ts:283-284` | `lib/db/complianceLicences.js:99,109` | yes |
| Audit kinds | `routes/compliance.ts:282` | none found; `CompliancePanel.jsx:386` has `AUDIT_STATUSES` (statuses, not kinds) | n/a |
| Inspection kinds | `routes/inspections.ts:29` | `components/InspectionsPanel.jsx:41` `KIND_META` | yes |
| Checklist results | `routes/inspections.ts:30` | `lib/db/inspections.js:30` | yes (pass, fail, na, pending) |
| Depreciation methods | `src/depreciation.ts:10` AND `routes/assets.ts:61` | `lib/db/depreciation.js:3` (schedules); `pages/Assets.jsx:276` `DEPRECIATION_LABEL` (per-asset override) | **No, three ways.** API: `assets.ts` has `none` and lacks `units_of_production`; `depreciation.ts` is the reverse. Frontend: `lib/db/depreciation.js` follows `depreciation.ts`; `Assets.jsx:276` offers only `straight_line`, `declining_balance`, `none`, so `sum_of_years_digits` (accepted by `assets.ts`) has no label in the asset form, and the label reads "Straight-line" there but "Straight line" on the Depreciation page. API side belongs to 05d. |
| Document kinds | `routes/documents.ts:17` (not exported) | `lib/db/documents.js:5` | yes |
| Asset statuses | `routes/assets.ts:27` (not exported) | `pages/Assets.jsx:41,63,67,68` | yes (7 values) |
| Lifecycle statuses, criticalities | `routes/assets.ts:62-63` | lifecycle: no frontend copy found; criticality: see RF-FE-21 | |

Target shape: rename or extend `packages/rbac` into a shared `@assetcore/domain` (or add `packages/domain`, same JS + `.d.ts` pattern) that exports the key arrays only. The API imports them for zod enums; the frontend keeps labels/tones in `lib/domain` keyed by them, plus a one-line dev assertion (`assertSameKeys(DEFECT_SEVERITIES, DEFECT_SEVERITY_META)`) that throws in dev if a key has no label. Effort M (touches API; coordinate with 05d). Risk low. Do it after RF-FE-21 so there is one frontend place to wire.

---

## F. Styling

### Numbers

- 2,855 `style={{...}}` blocks vs 632 `className=` in `apps/app/src`. Top files: Admin 312, Assets 278, WorkOrders 214, CompliancePanel 178, Approvals 165, Risks 158, Maintenance 138, SpareParts 133 (unrouted, see 05a), Depreciation 130, Defects 128.
- `packages/ui/index.css` is 645 lines with about 70 classes; several are defined and barely or never used: `.modal-overlay` / `.modal-card` (0 uses), `.label` (44 uses vs about 45 inline label styles), `.filter-pill` (11 uses, but the class sets only layout, so every use re-types the active/inactive colours inline: 9 ternaries `? 'var(--b300)' : 'var(--n200)'` in `Assets.jsx`, `WorkOrders.jsx`, `Onboarding.jsx`, `CompliancePanel.jsx`).
- `.btn` is used 186 times, and 127 of those override `height` inline (34 or 36px with `padding:'0 16px'`/`'0 18px'`, `fontSize:13`): the de facto button is not the one in the CSS. 15 more primary buttons are hand-rolled with `background:'var(--b500)', color:'#fff'` (e.g. `Assets.jsx` ~1490).
- 21 distinct `fontSize` values (440x 12, 351x 13, 260x 11, 73x 10, 55x 11.5, 38x 12.5, 20x 10.5, ...). 11 distinct `borderRadius` values (4, 6, 8, 3, 10, 2, 99, 5, 999, 12, 20).
- Top repeated literal style blocks (whitespace-normalised): `{width:'100%'}` 49 (redundant on `.input`), `{padding:'11px 14px'}` 33 (table cell), `{fontSize:11,color:'var(--n500)'}` 29, `{height:34,padding:'0 16px',fontSize:13}` 25 (button size), the page-shell column 25, `{display:'flex',flexDirection:'column',gap:12}` 22, `{width:'100%',borderCollapse:'collapse'}` 20, `{flex:1,overflowY:'auto'}` 20, page title `{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}` 19 (11 of them on pages that also have `.page-header`), backdrop 18 + 9, table header row `{background:'var(--n50)',borderBottom:'var(--bdr)'}` 15, card `{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}` 14, uppercase table `th` 9.
- Colours: good token discipline overall. Literal colours: 48 hex (45 are `'#fff'`, mostly white text on brand fills, which is fine; `--b-solid` exists for this), 77 `rgba/oklch` literals: backdrops `rgba(0,0,0,.4)` x28, `.35` x11, `.2` x9 (three different backdrop opacities), and the risk "high" orange band `oklch(.. 45)` in `lib/db/risks.js:45` with no token. No `@media (prefers-color-scheme)` concerns: dark mode is a `[data-theme=dark]` block (`packages/ui/index.css:286`) that remaps tokens, so token use is what keeps dark mode working; the literal backdrops are fine in both themes.
- Hover via JS: `components/Topbar.jsx:134,141` set `style.background` in `onMouseEnter`/`onMouseLeave`, which a `:hover` rule replaces.

### RF-FE-23 Promote the de facto styles into classes (LOW, broad)

Target shape, added to `packages/ui/index.css` (names indicative):
- Buttons: `.btn-sm` (36px, 0 16px, 13px) and `.btn-xs` (30-34px, 12px). Removes about 127 inline overrides.
- Pills: `.filter-pill` gets the border/background/colour and `.filter-pill.is-active`; `.tab-btn.is-active` likewise.
- Tables: `.tbl` (`width:100%; border-collapse:collapse`), `.tbl th` (the uppercase mono header), `.tbl td` (`11px 14px`), `.tbl-head` row background.
- Surfaces: `.card` (n0, bdr, radius 6, overflow hidden), `.panel-scroll` (`flex:1; overflow-y:auto`), `.stack-12` (`flex column gap 12`).
- Text: `.muted` (11/12px `--n500`), `.faint` (`--n400`), `.page-title` (the 22px display heading), `.form-error` (12px `--srt`).
- Tokens: `--radius-sm/md/lg` (4/6/10), `--backdrop` (one opacity), `--z-panel/--z-modal/--z-toast`, a `--so*` orange set for the risk "high" band.

Rule for new code: inline `style` only for values computed at runtime (widths from data, colours from a tone map). Migrate opportunistically file by file, together with each file's split (G), not as one sweeping commit, because a 2,800-line style diff is unreviewable. Effort L in total, S per file. Risk low per file, but visual: each migrated page needs a screenshot check in light and dark at 390px and desktop.

### RF-FE-24 Pick one pill system (LOW)

Evidence: `components/StatusBadge.jsx` renders inline tone objects; `.badge` + `.badge-g/-a/-r/-b/-n/-ip` (`packages/ui/index.css:177-193`) render the same thing via classes, used 22 times. Radius differs (`StatusBadge` 2px, `.badge` 2px, `Integrity.jsx:18` `Pill` its own). Target: `StatusBadge` takes `tone` as a name and renders `.badge badge-{tone}`; the tone-object maps in RF-FE-21 shrink to tone names. Effort S once RF-FE-21 is done.

---

## G. God files: what is inside, and which splits pay off

Churn = `git log --oneline -- <file> | wc -l` at baseline. "Hot sections" = enclosing function names counted from hunk headers in `git log -p` for that file (a rough but honest signal of where edits land).

| File | Lines | Commits | Hot sections (hunks) | Split? |
|---|---|---|---|---|
| pages/Assets.jsx | 1720 | 29 | main 61, AssetDetailPanel 36, AssetModal 32 | **Yes, first** |
| pages/Admin.jsx | 1689 | 18 | UsersTab 24, InviteModal 12, ConfigTab 12, AuditTab 11 | **Yes** (tabs are independent) |
| pages/WorkOrders.jsx | 1110 | 15 | WODetail 32, main 25, NewWOModal 16 | **Yes** |
| pages/Maintenance.jsx | 640 | 15 | main 47 | Light (extract week view + modals) |
| components/CompliancePanel.jsx | 930 | 4 | | Audits half only, when next touched |
| pages/Approvals.jsx | 753 | 5 | | No (after primitives it shrinks) |
| pages/Risks.jsx | 682 | 5 | | No |
| pages/Defects.jsx | 599 | 3 | | No |
| components/InspectionsPanel.jsx | 588 | 4 | | No |
| pages/Depreciation.jsx | 565 | 4 | | No |
| pages/SpareParts.jsx | 509 | 3 | | **No: not routed** (`App.jsx:133` renders `ComingSoon` for `/spare-parts`; 05a decides its fate) |

Low-churn files will lose roughly a third of their lines from the shared primitives alone (Modal, Stat, Field, fmtDate, useResource); splitting them now is cost without return.

### RF-FE-25 Split pages/Assets.jsx (MEDIUM, L)

Inside (line ranges at baseline):
- 1-75 imports, status constants (`STATUS_STYLE` 41, picker/legacy keys 63-73)
- 76-92 `AssetStatusBadge`; 93-175 `ConditionPanel`; 176-187 `HealthBar`
- 188-218 helpers `fmtDate`, `fmtDateTime`, `nextMaintColor`, `Field`
- 219-274 CSV helpers (`CSV_HEADERS`, `csvCell`, `downloadTemplate`, `parseCSV`)
- 275-614 `AssetModal` (add/edit, 333 lines, photos, documents, depreciation override)
- 615-691 `RaiseWOModal`; 692-782 `CompleteMaintenanceModal` (+ `localDateStr`); 783-833 `PMTaskCompleteModal`; 834-897 `ImportModal`
- 898-1329 `AssetDetailPanel` (424 lines: activity, PM, inspections, WOs, transfers, health)
- 1330-1720 `Assets` page (filters, table, mobile cards, modal wiring)

Target:
```
pages/assets/AssetsPage.jsx          (main, ~300 after primitives)
pages/assets/AssetModal.jsx          (275-614)
pages/assets/AssetDetailPanel.jsx    (898-1329, + ConditionPanel, HealthBar)
pages/assets/assetModals.jsx         (RaiseWOModal, CompleteMaintenanceModal, PMTaskCompleteModal)
pages/assets/ImportModal.jsx + lib/csv.js  (219-274 helpers are pure, unit-testable)
lib/domain/asset.js                  (STATUS_STYLE, picker keys, legacy keys, STATE_FILTERS)
pages/Assets.jsx                      re-exports default from ./assets/AssetsPage.jsx (keeps App.jsx import stable)
```
`RaiseWOModal` here and `NewWOModal` in WorkOrders.jsx:56 both create a work order; check whether one can serve both before moving (likely yes with an `asset` prop that pre-fills and locks the asset).
Effort L (own session). Risk medium: many props flow between main and panel; do it as pure moves first (one commit), then primitives.

### RF-FE-26 Split pages/Admin.jsx by tab (MEDIUM, M)

Inside: 1-52 imports, `CAP_LABELS`, `GRANTABLE_CAPS`; 53-211 shared bits (`Chip`, `BulkToggle`, `ScopeCapsFields`); 212-409 Sites (`SiteModal`, `ShutdownSiteModal`, `SitesTab`); 410-508 Locations; 509-604 Categories; 605-991 Users (`ROLES_LIST`, `PERMISSION_MATRIX_GROUPS`, `PermissionsMatrix`, `initials` (duplicate), `InviteModal`, `AccessModal`, `UsersTab`); 992-1165 Audit log; 1166-1347 Configuration; 1348-1636 Escalations (`RuleModal`, `EscalationsTab`); 1637-1689 page with `TABS`.

Target: `pages/admin/AdminPage.jsx` (TABS + shell), one file per tab (`SitesTab.jsx`, `LocationsTab.jsx`, `CategoriesTab.jsx`, `UsersTab.jsx` with its modals and `PermissionsMatrix`, `AuditTab.jsx`, `ConfigTab.jsx`, `EscalationsTab.jsx`), `pages/admin/accessFields.jsx` for `Chip`/`BulkToggle`/`ScopeCapsFields`/`CAP_LABELS` (shared by Invite and Access modals). The tabs share no state, so this is the safest big split in the app. Lazy-load the tabs (`React.lazy`) as a bonus: Admin is rarely opened. Effort M. Risk low.

### RF-FE-27 Split pages/WorkOrders.jsx (MEDIUM, M)

Inside: 1-54 imports, `STATUS_COL_ORDER`, `PriorityBadge`, `TypeBadge`, `fmtNaira`, `SlaDue`; 55-203 `NewWOModal`; 204-308 `EditWOModal`; 309-835 detail (`SectionHead`, `Checklist` 321, `SpendApproval` 398, `PartsSection` 496, `WODetail` 575-835); 836-1110 page (list + board with drag state).

Target: `pages/work-orders/WorkOrdersPage.jsx` (list + board, consider `WorkOrderBoard.jsx` for the drag-and-drop part), `WorkOrderModals.jsx` (New/Edit, which share most fields: a single `WorkOrderForm` used by both is the real win; the 17 inline weight-600 labels live here), `WorkOrderDetail.jsx` (+ `Checklist`, `PartsSection`, `SpendApproval`). Effort M. Risk medium (board drag state and deep-link effect at `:889-895`).

### RF-FE-28 Maintenance.jsx: extract, do not split (LOW, S)

The page component itself (120-407) is where edits land. Move the week strip (`weekDays` 38-43 and the render block around 330-370) to `components/WeekStrip.jsx`, and the four modals/tables after the default export (408-640) to `pages/maintenance/*`. Keep the page. Effort S. Risk low.

### CompliancePanel.jsx (IDEA)

Two features in one file: licences (1-252, 692-930) and audits (253-691: `AuditFindingsModal`, `YesNo`, `AuditModal` 393-586, `AuditsPanel` 587-691). If audits get more work, move 253-691 to `components/compliance/AuditsPanel.jsx`. Not before.

---

## H. Tooling gaps that make refactoring risky

Facts: `apps/app/package.json` has only `dev`, `build`, `preview`. No ESLint config anywhere in the repo, no frontend test runner, no `jsconfig.json`. `.github/workflows/deploy.yml` only SSHes to the VPS and runs the deploy script: nothing lints or builds before deploy. `vite build` does not catch an undefined identifier inside a component (it fails at runtime, on that page, for that user).

Dry run (for this audit only, ESLint 9 installed in the scratchpad, nothing added to the repo): `no-undef`, `react/jsx-no-undef`, `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, `no-unused-vars` over `apps/app/src` gives **0 errors**, 9 unused-variable warnings (`CompliancePanel.jsx:11,18,174`, `Approvals.jsx:419`, `Devices.jsx:6`, `Maintenance.jsx:1,14,29`, `WorkOrders.jsx:604`, which 05a covers), 2 `exhaustive-deps` warnings (`AssetMapPage.jsx:36`, `Notifications.jsx:89`, both harmless) and 1 stale `eslint-disable` (`Approvals.jsx:459`). The code is already lint-clean in practice, so adding ESLint costs almost nothing and immediately protects every move below.

### RF-FE-29 Add ESLint before any refactor (MEDIUM as an enabler, S)

Minimal `apps/app/eslint.config.js` (flat config): `@eslint/js` recommended off except `no-undef` (error), `no-unused-vars` (warn, `args: 'none'`), `react/jsx-no-undef` + `react/jsx-uses-vars` (error), `react-hooks/rules-of-hooks` (error), `react-hooks/exhaustive-deps` (warn). Add `"lint": "eslint src"` to the app package and a root `lint` script. Optional but cheap: `no-restricted-syntax` banning `alert(` and `CallExpression[callee.name="can"]` with fewer than 3 args (enforces RF-FE-01 until `useCan` lands). Effort S. Risk none.

### RF-FE-30 A gate in CI (MEDIUM as an enabler, S)

Add a job before the deploy step (or a separate `check.yml` on push/PR) running `npm ci`, `npm run lint -w @assetcore/app`, `npm run build`, and the API tests that already exist. Today a broken build reaches the VPS deploy script. Effort S. Risk none.

### RF-FE-31 Tests where they are cheap and where they protect the refactor (S then M)

1. Vitest unit tests for the pure modules the refactor creates or centralises: `lib/errors.js` (`errorText` + overrides), `lib/money.jsx` (`fmtMoney`, `fmtMoneyExact`, `convert`), `lib/dates.js` (the UTC/local bug is exactly a test case), `lib/health.js`, `lib/notificationLink.js`, the CSV `parseCSV` from Assets, and `packages/rbac` `can()` with `extraCaps` and `EXPLICIT_ONLY_CAPS`. Effort S. These need no DOM.
2. One Playwright route smoke test: sign in with seeded users for 3-4 roles (seed currently creates only an `owner`, `scripts/seed-dev.mjs:70`; add a viewer and a supervisor), visit every route in the route table, assert no `ErrorBoundary` text and no console error, open the first row's detail panel and the main "New" modal where present. This is the safety net for the file splits and the Modal/PageShell migration. Effort M. The existing `uat/` walkthroughs list the flows worth adding later.
3. Component tests (Testing Library) only for `useResource` and `Modal` once written. Not for pages.

### RF-FE-32 Types: JSDoc + `checkJs` on `src/lib/` only (IDEA, S)

Recommendation: no TypeScript migration. Add `apps/app/jsconfig.json` with `checkJs: true` scoped to `src/lib/**` and write JSDoc on `apiClient`, `lib/db/*`, `lib/domain`, `lib/dates`, `useResource`. One-line rationale: the API is already strict TS and `packages/rbac` already ships `index.d.ts`, so typed boundaries in `lib/` catch wrong helper signatures and misspelled map keys at the place pages touch the API, without touching 15k lines of JSX. Run it as `tsc -p apps/app/jsconfig.json --noEmit` in the CI job. Effort S to set up, then incremental.

### Order before refactoring

1. RF-FE-29 ESLint (S). 2. RF-FE-30 CI gate (S). 3. RF-FE-31 step 1 unit tests (S). 4. RF-FE-31 step 2 route smoke (M) before any file split. 5. RF-FE-32 optional, any time.

---

## Bugs seen in passing (not chased; verify before fixing)

| # | Where | What | Severity guess |
|---|---|---|---|
| B1 | `pages/Risks.jsx:342-343`, `Defects.jsx:308-312`, `SpareParts.jsx:239-241`, `Approvals.jsx:422`, `Depreciation.jsx:354` | `can()` without `extraCaps`: per-user grants ignored on these pages (RF-FE-01). | Medium |
| B2 | `pages/Integrations.jsx:116` | Integration Save failure swallowed; user gets no error. | Medium |
| B3 | `pages/Notifications.jsx:120-124` | Preference toggle optimistic with no rollback on failure. | Medium |
| B4 | `pages/Settings.jsx:42-50` | Profile load failure leaves blank form; Save then writes an empty `full_name`. | Medium |
| B5 | `pages/Assets.jsx:397-398` | New-asset photo/document upload failures hidden behind "Asset created." | Medium |
| B6 | `lib/auth.js:48-51` via `lib/AuthContext.jsx:26` | If the server is unreachable at page load and the stored token is expired, `refreshAccessToken()` rejects, `getSession()` rejects, the `.then` never runs and `loading` stays true: the app sits on the Splash forever instead of showing the offline banner or the sign-in page. | Medium |
| B7 | 7 sites listed in RF-FE-18 | "Today" computed in UTC: one hour after local midnight in UTC+1, defaults and overdue checks are a day behind. `Defects.jsx:56` also freezes the date at module load. | Low-Medium |
| B8 | `pages/WorkOrders.jsx:38,711,1030`, `pages/Depreciation.jsx:19` | Money shown with ₦ regardless of the org's base currency. | Medium for non-NGN orgs |
| B9 | `pages/Integrity.jsx:62-65`, `SpareParts.jsx:254`, `Assets.jsx:1371`, `WorkOrders.jsx:874`, `Maintenance.jsx:164` | No stale-response guard: switching filters or location quickly can render the older response last. | Low |
| B10 | `pages/Assets.jsx:276-280` | Per-asset depreciation override offers no `sum_of_years_digits` though the API (`routes/assets.ts:61`) accepts it; an asset carrying it renders without a label. | Low |
| B11 | `lib/AuthContext.jsx:54-60` | `/org` + `/sites` load has no catch: failure leaves `org` null (currency silently falls back to NGN) and an unhandled rejection. | Low |
| B12 | `components/Sidebar.jsx:50` + `App.jsx:150` vs API `routes/compliance.ts:45` | Neither the UI nor the list endpoint checks `compliance:read`, which `supervisor` and `officer` do not hold; only `/compliance/pm-compliance` (`:245`) does. Either the capability is meaningless for reads or the list is under-gated. Hand to 05d / security. | Check |
| B13 | `pages/Notifications.jsx:87-89` | `selected` is a snapshot object; after the 30 s poll refreshes `notifications`, the detail pane keeps showing the old read state. | Low |
| B14 | 8 modals listed in RF-FE-14 | Fixed widths with no `maxWidth`; they fit a phone only because a flex child shrinks. Fragile rather than broken. | Low |

---

## Top 10 refactors, by value for effort

| Rank | ID | What | Effort | Risk | Why it ranks here |
|---|---|---|---|---|---|
| 1 | RF-FE-29 + 30 | ESLint config (baseline already passes) + CI job running lint, build, API tests before deploy | S | none | Makes every later move safe; costs an hour. |
| 2 | RF-FE-01 | `useCan()` hook; migrate 62 `can(` call sites | S-M | low | Fixes a live permissions bug (B1) and removes the way it happens. |
| 3 | RF-FE-10 | Fix the 4 swallowed save errors (+ Settings blank-save) | S | low | User-visible silent failures. |
| 4 | RF-FE-20 + 18 + 19 | `lib/dates.js` and money through `useMoney` (kill `fmtNaira`, `exact`, 7 `fmtDate`s, UTC "today") | S | low | Three drifting copies, two real bugs, trivial to test. |
| 5 | RF-FE-31 (1) | Vitest for errors, money, dates, health, rbac, CSV parse | S | none | Locks the helpers from 4 before pages start depending on them. |
| 6 | RF-FE-13 | `useResource` hook; adopt on Integrity, Depreciation, WorkOrders first | M | low | Removes ~12 lines per page, fixes stale responses, enforces visible errors. |
| 7 | RF-FE-14 + 12 | `<Modal>` on the existing `.modal-overlay/.modal-card`, plus `useConfirm` and `alert` -> toast | M | low | 33 modals, Escape-to-close everywhere, phone-safe widths. |
| 8 | RF-FE-21 (+ 24) | `lib/domain` status/priority/entity maps and one `StatusBadge` on `.badge-*` classes | M | low-med | Ends the colour/label drift; prerequisite for 22. |
| 9 | RF-FE-31 (2) then RF-FE-26 | Route smoke test, then split Admin.jsx by tab | M + M | low | The cleanest big split; tabs share no state. |
| 10 | RF-FE-25, RF-FE-27 | Split Assets.jsx and WorkOrders.jsx (pure moves first, then primitives) | L + M | medium | Highest churn files; only worth doing once 6-8 have shrunk them. |

Next tier (do opportunistically): RF-FE-02 route table (M), RF-FE-07 one fetch core (M, auth path, needs the smoke test), RF-FE-15 PageShell + RF-FE-03 ThemeContext (S-M), RF-FE-16 form primitives (M), RF-FE-23 CSS classes per file as each file is touched, RF-FE-22 shared enum package with 05d, RF-FE-04/05 context memoisation (S).

### Suggested order and what can run in parallel

```
Phase 0  (sequential, first)      RF-FE-29 ESLint -> RF-FE-30 CI gate
Phase 1  (parallel, independent)  [a] RF-FE-01 useCan
                                   [b] RF-FE-10 swallowed saves + RF-FE-11 errorText overrides
                                   [c] lib/dates.js + money (RF-FE-18/19/20) + unit tests (RF-FE-31.1)
                                   [d] RF-FE-04/05 context memo + AuthContext catches (B6, B11)
Phase 2  (parallel, new files only, each piloted on 1-2 pages)
                                   [e] RF-FE-13 useResource
                                   [f] RF-FE-14 Modal + useConfirm (+ CSS tokens for z-index/backdrop)
                                   [g] RF-FE-17 Stat / EmptyState / TableState, RF-FE-16 Field
                                   [h] RF-FE-21 lib/domain + StatusBadge
                                   [i] RF-FE-31.2 route smoke test
Phase 3  (sequential per file; parallel ACROSS files only if different people/sessions own different files)
                                   RF-FE-26 Admin split -> RF-FE-27 WorkOrders split -> RF-FE-25 Assets split,
                                   each: pure move commit, smoke test, then adopt Phase 2 primitives + RF-FE-23 classes in that file
Phase 4  (any time after 2)        RF-FE-02 route table (+ RF-FE-15 PageShell, RF-FE-03 ThemeContext),
                                   RF-FE-07 fetch core (needs smoke test), RF-FE-22 shared enums (with 05d)
```

Must be sequential: Phase 0 before everything; RF-FE-01 before RF-FE-02 (Gate uses the hook); RF-FE-21 before RF-FE-22 and RF-FE-24; the smoke test (RF-FE-31.2) before any Phase 3 split or RF-FE-07; within one big file, the pure-move commit before any primitive adoption. Safe in parallel: everything inside Phase 1, and everything inside Phase 2, because each item creates new files and pilots on different pages. Two sessions must not edit the same page file at once: Phase 2 pilots should be assigned to distinct pages (e.g. useResource on Integrity/Depreciation, Modal on Defects/Risks, domain maps on Analytics/Dashboard).
