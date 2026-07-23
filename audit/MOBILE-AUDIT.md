# AssetCore Mobile Responsiveness Audit

Audited at: `claude/mobile-responsiveness-audit-49720d @ f95395f` (2026-07-23) · Method: three parallel code audits (design system + shell, five largest staff pages, remaining pages + admin app) + verification reads of every load-bearing citation. Target viewport: ~375px (staff phones). Companion plan: `audit/MOBILE-PLAN.md`.

## Executive summary

Overall: **navigable but not workable on a phone**. The foundation is healthier than expected — viewport meta is correct in both apps, the staff sidebar is already a proper off-canvas drawer at ≤768px with hamburger + overlay (`packages/ui/index.css:298-322`), a 44px touch-target rule exists for `@media (pointer: coarse)`, and every modal that sets `maxWidth:'92-94vw'` shrinks correctly. The admin app (`apps/admin`) is Mantine-based and broadly responsive already.

The staff app's page content, however, is desktop-fixed: **zero `@media` queries exist in `apps/*/src`**, and every multi-column layout is an inline `gridTemplateColumns`/fixed-width style — which no media query in the CSS file can override. That single root cause produces all four CRITICALs.

Counts: **4 CRITICAL · 8 HIGH · 10 MEDIUM · ~10 LOW**.

The three most important things:
1. **Fixed-width detail panels crush the screen** — Assets (360px), Work Orders (400px), Compliance (320px) render the detail panel as a `flexShrink:0` sibling of the list; Maintenance renders a 300px week panel *unconditionally*. On a 375px viewport the list is left 15-75px wide.
2. **Dashboard and Notifications are unusable at 375px** — a `repeat(5,1fr)` KPI row, `'280px 1fr'` and `'1fr 360px'` body grids, and a permanent 340px list pane beside the notification detail.
3. **Touch targets miss the existing 44px rule** — the `pointer:coarse` CSS only covers `.btn/.input/.tab-btn`, but nearly every filter pill, row action, and select on the work pages is inline-styled at 28-32px.

## CRITICAL (page unusable at 375px)

| # | Finding | Evidence |
|---|---|---|
| MC1 | Detail panels rendered as fixed-width flex siblings of the list — panel eats the viewport, list collapses to slivers | `Assets.jsx:769` (`width:360,flexShrink:0`, mounted 1218-1232), `WorkOrders.jsx:203,212` (`width:400`), `Compliance.jsx:186` (`width:320`, mounted 631) |
| MC2 | Maintenance "This week" panel (`width:300,flexShrink:0`) rendered unconditionally beside the task table — cannot be dismissed, table left ~75px | `Maintenance.jsx:236` |
| MC3 | Dashboard grids fixed at all widths: KPI `repeat(5,1fr)` (~59px per card holding 30px numerals), body `'280px 1fr'`, bottom `'1fr 360px'` (360px track alone exceeds the ~327px content area) | `Dashboard.jsx:134,183,285` |
| MC4 | Notifications two-pane layout: list `width:340,flexShrink:0` + `flex:1` detail, both always shown, no stacking or toggle — detail and preferences unusable | `Notifications.jsx:115,156`; prefs grid `'1fr 72px 56px'` at `:198,204` |

## HIGH (feature broken or overflowing)

| # | Finding | Evidence |
|---|---|---|
| MH1 | Topbar overflows: non-wrapping row with fixed `width:260` search + breadcrumb + LocationSwitcher + icons; nothing collapses on mobile except the hamburger appearing | `Topbar.jsx:88,101,106` |
| MH2 | Modals with fixed px width and **no maxWidth** overflow the screen: NewWOModal w520 (worst), SiteModal w400, LocationModal w380, CatModal w380, invite-link view w460, reset-link modal w460 | `WorkOrders.jsx:75`, `Admin.jsx:158,275,374,562,786` (correct pattern to copy: `Admin.jsx:576,633`) |
| MH3 | Admin 6-tab strip: no wrap, no overflow-x — last tabs unreachable at 375px | `Admin.jsx:981` |
| MH4 | Devices EmptyState: two-column flex with `width:300,flexShrink:0` panel + `gap:40` + `padding:40`, no wrap — overflows; first thing a new user sees | `Devices.jsx:283-324` |
| MH5 | Devices filter chip row: 5 chips, no `flexWrap`, no scroll — overflows | `Devices.jsx:195-207` |
| MH6 | Touch targets below 44px across all work pages: filter pills h28-30, row actions `padding:'3px 8px' fontSize:11` or `padding:0`, inline selects h28, kebab `padding:4` — all skip the `pointer:coarse` rule because it only targets `.btn/.input/.tab-btn` | pills: `Assets.jsx:1104`, `Compliance.jsx:562`, `WorkOrders.jsx:362,367`; actions: `Assets.jsx:1067→1205-1207`, `Admin.jsx:231-232,335-336,432-433,747-749`, `Compliance.jsx:620,440-441,437`, `Maintenance.jsx:417,318`, `WorkOrders.jsx:256,453`; selects: `Assets.jsx:1135,1144,852,875`, `Admin.jsx:734-735`; rule: `index.css:326-331` |
| MH7 | Reports library table (8 cols) rendered inside a padded div with no horizontal-scroll wrapper — relies on incidental overflow coercion, clips awkwardly | `Reports.jsx:137-138` (container `:120`) |
| MH8 | Core work tables are 8-10 columns of `whiteSpace:nowrap` — technically scrollable but hostile for daily phone use (decision: card-list transform for Assets / Work Orders / Maintenance) | `Assets.jsx:1180` (10 col), `WorkOrders.jsx:432` (9 col), `Maintenance.jsx:385` (8 col) |

## MEDIUM (degraded)

| # | Finding | Evidence |
|---|---|---|
| MM1 | Global mobile rule `table { min-width:560px }` breaks tables inside modals, which have no x-scroll wrapper (modal is ~345px with `overflowY` only) | `index.css:320`; e.g. `Maintenance.jsx:432` |
| MM2 | `.table-scroll` helper defined but used **nowhere**; pages re-implement inline `overflowX:'auto'` or set only `overflowY:'auto'` and rely on CSS overflow coercion | `index.css:321`; parents at `Admin.jsx:698,846`, `Compliance.jsx:580,395`, `Maintenance.jsx:205,297`, `Inspections.jsx:233`, `Devices.jsx:222` |
| MM3 | In-modal `'1fr 1fr'` form grids never stack (~160px per field in a phone-width modal) | `Assets.jsx:298,465,554,975`, `Compliance.jsx:113,135,305,313,324`, `Inspections.jsx:73`, `Devices.jsx:91,103`, `WorkOrders.jsx:90,104,120`, `Maintenance.jsx:68`, `Settings.jsx:146`, `Reports.jsx:264` |
| MM4 | Non-wrapping header/stat rows overflow: Compliance AuditsPanel header (wide PM-compliance badge), Maintenance compliance-stub 3 stat cards, Dashboard page header | `Compliance.jsx:396-407`, `Maintenance.jsx:284`, `Dashboard.jsx:109,116` |
| MM5 | Fixed-count grids that can't stack: Reports template picker `repeat(3,1fr)`, Onboarding category picker `repeat(3,1fr)`, Onboarding add-site `'1fr 120px'` | `Reports.jsx:248`, `Onboarding.jsx:238,197` |
| MM6 | Onboarding StepBar labels crowd/overflow at 375px; step cards use `padding:40` | `Onboarding.jsx:22-45,152,184,234` |
| MM7 | Topbar popovers can collide with the viewport edge (profile menu w250 right-anchored, location menu minWidth:200) | `Topbar.jsx:131,46` |
| MM8 | [admin-app] OrgDetail Users/Audit/Billing tab tables lack `Table.ScrollContainer`; Support snapshot tables x-overflow | `OrgDetail.jsx:36,90,113`, `Support.jsx:97,114,131` |
| MM9 | [admin-app] `Group grow` rows pack 3 inputs that can't wrap (~110px each on phone) | `Billing.jsx:89,94,237`, `OrgDetail.jsx:266` |
| MM10 | Admin Users table: 5 columns with a 3-button action cell + role select — scrolls but heavy | `Admin.jsx:712,734,747-749` |

## LOW (polish)

- `.app-shell` `height:100vh` — mobile URL bar clips the bottom; needs `100dvh` fallback (`index.css:87`).
- Search placeholder advertises "⌘K" on phones (`Topbar.jsx:106`).
- Auth/NotConfigured cards use fixed `width:480/440/520` and only fit because flex-shrink rescues them — make `width:'100%',maxWidth:N` explicit (`Auth.jsx:41`, ForgotPassword, ResetPassword, ForcePasswordChange, `NotConfigured.jsx:6`).
- Small touch targets outside work pages: show-password 32×32 (`Auth.jsx:64`), Notifications/Integrations toggles 36×20 (`Notifications.jsx:230-234`), photo-remove button 18×18 at −6px offset (`Assets.jsx:388`).
- Settings LicenceCard `'1fr 1fr'` tight but readable (`Settings.jsx:146`).
- [admin-app] Login `Paper w={400}` overflows 375px by ~25px (`Login.jsx:36`).

## Already correct (do not "fix")

- Viewport meta in both apps (`apps/app/index.html:5`, `apps/admin/index.html:5`).
- Staff sidebar mobile drawer + hamburger + overlay (`index.css:298-322`, `Sidebar.jsx:90-91`, `Topbar.jsx:89-92`, SidebarContext). Admin AppShell via Mantine (`AdminShell.jsx:36-44`).
- Modals that set `maxWidth:'92-94vw'` (`Assets.jsx:290,455,541,606,657`, `Compliance.jsx:103,295`, `Devices.jsx:81`, `Maintenance.jsx:55,355`, `Inspections.jsx:63,128`, `Admin.jsx:576,633`).
- WorkOrders kanban: 240px columns inside `overflowX:'auto'` is intentional horizontal scroll and works (`WorkOrders.jsx:402-404`).
- `repeat(auto-fill,minmax(...))` grids (`Admin.jsx:222,326`, `Reports.jsx:201`), `ToastContext.jsx:38`, `ImageLightbox.jsx:60-61`, Settings forms, Integrations page, all four auth pages (operable), StatusBadge, banners, ErrorBoundary.
- No `window.innerWidth`/JS width assumptions anywhere — all fixes are CSS/markup (plus two small state-driven pane swaps).

## Coverage statement

Fully read: `packages/ui/index.css`, both `index.html` files, `Sidebar.jsx`, `Topbar.jsx`, `AdminShell.jsx`, all 18 staff pages (`apps/app/src/pages/*`), staff page-level components (Toast, Lightbox, StatusBadge, banners, ErrorBoundary, AuthImage), all admin-app pages. Verified by direct re-read: every CRITICAL citation and the topbar/modal/index.css citations. Not audited (out of scope): actual device testing, Safari-specific quirks, network/perf on mobile.
