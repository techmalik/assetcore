# Implementation Plan — AssetCore Mobile Responsiveness
Generated: 2026-07-23 · From audit: audit/MOBILE-AUDIT.md

## How to execute this plan

Work wave by wave, in order — Wave M1 defines shared CSS classes that later tasks use. One task per session for L tasks. Run the task's Verify step before marking it done. Commit per task with the task ID in the message (e.g. `TASK-M2.1: detail panels become full-screen overlays on mobile`). If a task's premise doesn't match the code you find (line drifted, style already changed), search for the quoted snippet instead of trusting the line number; if the premise is genuinely gone, stop and ask.

**Verification setup (used by every task):** run the app locally (`npm install`, `npm run migrate && npm run seed:dev` if a DB is available, then `npm run dev` for the staff app on Vite's default port). Check pages in Chromium at **375×812** (Playwright is available; launch with `executablePath: '/opt/pw-browsers/chromium'` and `viewport: {width:375, height:812}`, or use browser devtools device emulation). The universal pass condition is **no horizontal page scroll**: `document.documentElement.scrollWidth <= 375`. Also re-check the same page at **1440px** — desktop must look unchanged. If the API/DB can't run, verify statically: build passes (`npm run build:app`) and the rendered DOM/CSS assertions below are checked with the dev server against whatever renders (login page + any reachable state).

**Conventions (apply to every task):**
- Mobile breakpoint is **768px** — same as the existing sidebar drawer breakpoint (`packages/ui/index.css:298`). Do not introduce other breakpoints unless a task says so.
- Shared classes live in `packages/ui/index.css`. Page fixes replace inline styles with those classes, because **inline styles cannot be overridden by media queries** — that is the root cause of most findings. When a task says "swap to class X", remove the inline properties that X now provides and keep the rest inline.
- Never touch the existing sidebar-drawer CSS block (`index.css:298-322` as of audit) except where a task explicitly says so.
- No JavaScript window-width logic. Responsive behavior is CSS-only, except TASK-M2.3 (Notifications pane swap) which uses existing React selection state.

## Decisions needed before execution

None — the three product decisions were made by the owner on 2026-07-23:
1. Staff app (`apps/app`) gets full mobile treatment; admin app (`apps/admin`) gets minimal fixes only (Wave M5).
2. Core work lists (Assets, Work Orders, Maintenance tasks) become card lists on mobile; all other tables get horizontal scroll.
3. Basic PWA install polish (manifest + icons), no offline mode / service worker.

## Wave M1 — Shared responsive foundation

### TASK-M1.1: Add responsive primitives to the shared stylesheet
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: M
- **Depends on**: none
- **Files**: `packages/ui/index.css`

**Problem**: The design system has mobile infrastructure (sidebar drawer at ≤768px, `pointer:coarse` 44px targets at `index.css:326-331`, an unused `.table-scroll` at `index.css:321`) but no primitives for the patterns that break on phones: fixed-width detail panels, fixed-px modals, two-column form grids, inline-styled pills/actions/selects that miss the touch rule, non-scrollable tab strips. Also: `table { min-width:560px }` inside the ≤768px block (`index.css:320`) applies to tables inside modals, which have no x-scroll wrapper, so they overflow the modal box; and `.app-shell` uses `height:100vh` (`index.css:87`), which clips under mobile browser URL bars.

**Fix**: In `packages/ui/index.css`:
1. `.app-shell`: keep `height:100vh;` and add `height:100dvh;` on the next line (fallback order matters — `dvh` last).
2. Inside the existing `@media (max-width:768px)` block, change `table { min-width: 560px; }` to `.table-scroll table { min-width: 560px; }` (tables not opted into scrolling no longer get forced wide; every list table gets wrapped in `.table-scroll` by TASK-M4.1).
3. Add these classes (base styles near the other component classes, mobile overrides inside the existing ≤768px media block):
   - `.modal-overlay { position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; padding:16px; }` and `.modal-card { width:min(var(--modal-w,520px),92vw); max-height:92vh; overflow-y:auto; background:var(--n0); border-radius:10px; }` — used by TASK-M2.5 for the broken modals; migrating already-correct modals is optional.
   - `.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }` and, at `max-width:600px` (a dedicated small query, since modals are narrow inside a 768px viewport too — put it in its own `@media (max-width:600px)` block): `.form-grid { grid-template-columns:1fr; }`.
   - `.detail-panel { width:var(--panel-w,360px); flex-shrink:0; border-left:var(--bdr); background:var(--n0); display:flex; flex-direction:column; overflow:hidden; }`; in the ≤768px block: `.detail-panel { position:fixed; inset:0; width:auto; z-index:150; border-left:none; }`.
   - `.tab-strip { display:flex; overflow-x:auto; flex-wrap:nowrap; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }`.
   - `.page-header { display:flex; align-items:center; flex-wrap:wrap; gap:12px; }`.
   - `.filter-pill`, `.row-action`, `.select`: define minimal base styles that match current inline usage (pill: inline-flex, centered, `border-radius:999px`; row-action: inline-flex centered text button; select: current select look) — pages will keep their color/size inline styles and only rely on these classes for the touch rule, so keep base styles minimal to avoid visual drift.
4. Extend the `@media (pointer:coarse)` block: add `.filter-pill, .row-action, .select { min-height:44px; }` and `.row-action { padding-left:10px; padding-right:10px; }`.

**Must not break**: Desktop rendering of every page must be pixel-equivalent (new classes are additive; the only changed existing rules are the `100dvh` addition and the `table` min-width scoping). The sidebar drawer block stays untouched apart from the table rule inside it.

**Verify**: `npm run build:app` passes. At 1440px, Dashboard/Assets/Admin look unchanged. At 375px, confirm in devtools that `.app-shell` computed height tracks the visual viewport and that a plain `<table>` (e.g. inside the Maintenance schedules modal) no longer has a 560px min-width.

### TASK-M1.2: Topbar collapses on mobile
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-M1.1
- **Files**: `apps/app/src/components/Topbar.jsx`, `packages/ui/index.css`

**Problem**: The topbar is a single non-wrapping flex row (`height:52`, `padding:'0 24px'`, `gap:16` at `Topbar.jsx:88`) containing hamburger + breadcrumb + LocationSwitcher + a fixed-width search box (`<div style={{position:'relative',width:260}}>` at `Topbar.jsx:101`) + notification icon + avatar. Fixed 260px + padding + gaps exceed a 375px viewport before the breadcrumb even renders — right-side controls push off-screen. The search placeholder advertises "⌘K" (`Topbar.jsx:106`), a desktop-only affordance. Dropdown menus (location menu `minWidth:200` at `:46`, profile menu `width:250` right-anchored at `:131`) have no viewport-collision handling.

**Fix**:
1. Give the search wrapper a class (e.g. `topbar-search`) instead of `width:260` inline; in `index.css` set `.topbar-search { width:260px; position:relative; }` and inside the ≤768px block `display:none`.
2. Add a search icon button (visible only ≤768px, mirror how `.sidebar-hamburger` toggles visibility) that, when tapped, shows a full-width search input overlaying the topbar row (simple conditional render with a close ✕; no routing changes — the input is currently non-functional decoration, keep it so).
3. Hide the breadcrumb text on mobile the same way (class + `display:none` in the media block).
4. In `LocationSwitcher` usage keep desktop as-is; on mobile show the pin icon + chevron only (wrap the label in a class hidden ≤768px).
5. Change the placeholder to `"Search assets, work orders…"` (drop `⌘K`) or hide the hint span on mobile.
6. Clamp both popover menus: add `maxWidth:'calc(100vw - 24px)'` to the location menu (`:46`) and profile menu (`:131`) styles.

**Must not break**: Desktop topbar identical (search 260px, breadcrumb visible, ⌘K may stay on desktop if implemented via hidden span). Hamburger behavior untouched.

**Verify**: At 375px on any page: no horizontal scroll; hamburger, search icon, bell, avatar all visible and tappable; opening the profile menu keeps it fully on-screen. At 1440px: unchanged.

## Wave M2 — Critical page layouts

### TASK-M2.1: Detail panels become full-screen overlays on mobile
- **Severity**: CRITICAL
- **Category**: frontend
- **Effort**: L
- **Depends on**: TASK-M1.1
- **Files**: `apps/app/src/pages/Assets.jsx`, `apps/app/src/pages/WorkOrders.jsx`, `apps/app/src/pages/Compliance.jsx`

**Problem**: Three pages render a selected-item detail panel as a fixed-width `flexShrink:0` flex sibling of the list, so on a 375px viewport the panel consumes nearly the whole screen and the list collapses to a sliver:
- `AssetDetailPanel`: `<div style={{ width: 360, flexShrink: 0, borderLeft: 'var(--bdr)', ... }}>` (`Assets.jsx:769`, mounted ~1218-1232).
- `WODetail`: same pattern with `width: 400` in both the loading state (`WorkOrders.jsx:203`) and loaded state (`WorkOrders.jsx:212`), mounted ~464.
- Compliance `DetailPanel`: `width:320,flexShrink:0` (`Compliance.jsx:186`, mounted ~631).

**Fix**: For each of the three panels:
1. Replace the inline layout properties (`width`, `flexShrink`, `borderLeft`, `background`, `display`, `flexDirection`, `overflow`) with `className="detail-panel"` from TASK-M1.1, setting `style={{'--panel-w':'360px'}}` (or 400/320 respectively) to preserve the desktop width.
2. Each panel already has a close (✕) control in its header row — confirm it exists, make sure it is rendered as a button of at least 40×40 tappable area on mobile (add `.row-action` class or padding).
3. WorkOrders: apply the class to both the loading-state div and the loaded panel so the loading flash doesn't fall back to the flex-sibling layout.

**Must not break**: Desktop: panel still appears as a right-hand column of its original width; list stays interactive next to it. Selecting a different row while the panel is open still updates the panel. The panel's internal scrolling (`overflowY` regions inside) keeps working.

**Verify**: At 375px: open /assets, tap a row → detail covers the full screen, close ✕ returns to the list; repeat for /workorders (list view) and /compliance (select a licence). `document.documentElement.scrollWidth <= 375` on all three pages with the panel open and closed. At 1440px: side-by-side layout unchanged.

### TASK-M2.2: Maintenance week panel stacks below the table on mobile
- **Severity**: CRITICAL
- **Category**: frontend
- **Effort**: S
- **Depends on**: none
- **Files**: `apps/app/src/pages/Maintenance.jsx`, `packages/ui/index.css`

**Problem**: The PM tab renders `<div style={{width:300,flexShrink:0,borderLeft:'var(--bdr)',...}}>` (`Maintenance.jsx:236`) — the "This week" calendar panel — unconditionally beside the task table. Unlike the selection-driven panels in TASK-M2.1, it can't be dismissed: at 375px it permanently occupies 300px, leaving ~75px for the table.

**Fix**: This panel should stack, not overlay (it's a summary, not a drill-in). Give the flex container that holds `[table area][week panel]` a class (e.g. `split-with-aside`) and the panel a class (e.g. `aside-panel` with `--panel-w:300px`); in `index.css` add, inside the ≤768px block: container `flex-wrap:wrap`, panel `width:100%; flex-shrink:1; border-left:none; border-top:var(--bdr);`. Ensure the container's parent allows vertical scrolling of the combined content (the page content area scrolls; check the container isn't `overflow:hidden` in a way that hides the stacked panel — adjust to `overflow:visible` or `auto` under the media query if needed).

**Must not break**: Desktop: 300px right-hand panel unchanged. Task table behavior (TASK-M3.3 later converts it to cards) unaffected.

**Verify**: At 375px on /maintenance (PM tab): task list uses the full width; scrolling down reveals the "This week" panel below it; no horizontal scroll. At 1440px: unchanged.

### TASK-M2.3: Notifications becomes a single-pane swap on mobile
- **Severity**: CRITICAL
- **Category**: frontend
- **Effort**: M
- **Depends on**: none
- **Files**: `apps/app/src/pages/Notifications.jsx`

**Problem**: The page is a permanent two-pane row: list pane `<div style={{width:340,flexShrink:0,borderRight:'var(--bdr)',...}}>` (`Notifications.jsx:115`) beside a `flex:1` detail/preferences pane (`:156`). Both always render; at 375px the list eats 340px and the detail/preferences pane gets ~35px. The preferences grid `gridTemplateColumns:'1fr 72px 56px'` (`:198,204`) is then unusable, and the `Toggle` control is a 36×20 inline div (`:230-234`) — far below the 44px touch minimum.

**Fix**:
1. The component already tracks which notification (or the preferences view) is selected. On mobile, show ONE pane at a time driven by that state: list by default; selecting an item or opening preferences swaps to the detail pane with a "← Back" button (44px tall) that clears the selection. Implement with two CSS classes (e.g. `notif-list` / `notif-detail`) plus a modifier on the page container when something is selected (e.g. `notif--detail-open`), and media-query rules: ≤768px `.notif-list { width:100%; }`, `.notif--detail-open .notif-list { display:none; }`, `.notif-detail { display:none; }`, `.notif--detail-open .notif-detail { display:flex; width:100%; }`. Desktop rules keep both visible (`width:340` list). The Back button renders only ≤768px (CSS-hidden on desktop).
2. Preferences grid: change `'1fr 72px 56px'` to `'minmax(0,1fr) auto auto'` so the fixed tracks stop forcing overflow, and let the label cell wrap.
3. Toggle: keep the 36×20 visual but wrap it in a button/label with `min-height:44px; min-width:44px; display:inline-flex; align-items:center; justify-content:center` so the hit area meets the touch rule.

**Must not break**: Desktop: two-pane layout unchanged, no Back button visible. Marking notifications read / preference saves keep working in both layouts.

**Verify**: At 375px: /notifications shows a full-width list; tapping an item shows full-width detail with a working Back; opening preferences likewise; toggles tappable; no horizontal scroll. At 1440px: unchanged.

### TASK-M2.4: Dashboard grids collapse on mobile
- **Severity**: CRITICAL
- **Category**: frontend
- **Effort**: S
- **Depends on**: none
- **Files**: `apps/app/src/pages/Dashboard.jsx`

**Problem**: Three inline grids never adapt: KPI row `gridTemplateColumns:'repeat(5,1fr)'` (`Dashboard.jsx:134`) → five ~59px cells holding 30px numerals at 375px; main grid `'280px 1fr'` (`:183`) → alerts panel crushed; bottom grid `'1fr 360px'` (`:285`) → the fixed 360px track alone exceeds the ~327px content area, forcing horizontal overflow. The page header row (`:109,116`) with date select + "Generate Report" doesn't wrap.

**Fix**:
1. `:134` → `gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))'` (self-responsive, stays inline; yields 2×3 at 375px, 5×1 on desktop).
2. `:183` and `:285`: inline styles can't respond to media queries, so give each a class (e.g. `dash-main-grid`, `dash-bottom-grid`) in `index.css` carrying the current desktop template, with `grid-template-columns:1fr` inside the ≤768px block. Remove the inline `gridTemplateColumns` (keep `display:'grid'`, gaps inline or move them to the class).
3. Header row (`:109`): add `flexWrap:'wrap'` (or `.page-header` from TASK-M1.1).

**Must not break**: Desktop: 5-across KPIs, 280px donut column, 360px right column, all unchanged (auto-fit with minmax(150px,1fr) renders 5 across at ≥1200px content width — confirm visually; if the desktop content area can drop below ~800px with the sidebar open, prefer a class + media query over auto-fit for the KPI row too). KPI click-through navigation (`role="button"` handlers) untouched.

**Verify**: At 375px: /dashboard shows KPIs in 2-3 per row, donut card full-width above alerts, recent-WO table above the right column content; no horizontal scroll. At 1440px: layout identical to before.

### TASK-M2.5: Fix modals that overflow the viewport (missing maxWidth)
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-M1.1
- **Files**: `apps/app/src/pages/WorkOrders.jsx`, `apps/app/src/pages/Admin.jsx`

**Problem**: Six modals declare a fixed px width with no `maxWidth`, so they overflow a 375px screen horizontally (content and buttons run off-screen): `NewWOModal` `width: 520` (`WorkOrders.jsx:75` — worst offender), `SiteModal` `width:400` (`Admin.jsx:158`), `LocationModal` `width:380` (`Admin.jsx:275`), `CatModal` `width:380` (`Admin.jsx:374`), invite-link success view `width:460` (`Admin.jsx:562`), reset-link modal `width:460` (`Admin.jsx:786`). Correct siblings to copy from: `Admin.jsx:576` (InviteModal form) and `Admin.jsx:633` (AccessModal) use `maxWidth:'94vw'`.

**Fix**: For each of the six, either add `maxWidth:'92vw'` (and `maxHeight:'90vh', overflowY:'auto'` where missing) to the existing inline style, or swap the card to `className="modal-card"` with `style={{'--modal-w':'520px'}}` etc. Pick ONE approach and use it for all six. The `<code>` link blocks in the invite/reset modals already use `wordBreak:'break-all'` — leave them.

**Must not break**: Desktop widths unchanged (520/400/380/460). Form submission, focus, and close behavior untouched.

**Verify**: At 375px: open New Work Order from /workorders and each Admin modal (site, location, category, invite → link view, reset link) — every modal fits within the viewport with visible action buttons; no horizontal scroll. At 1440px: unchanged.

### TASK-M2.6: Unclip tab strips and non-wrapping header rows
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-M1.1
- **Files**: `apps/app/src/pages/Admin.jsx`, `apps/app/src/pages/Compliance.jsx`, `apps/app/src/pages/Maintenance.jsx`, `apps/app/src/pages/Reports.jsx`

**Problem**:
- Admin's six tabs (Locations, Sites, Asset Categories, Users & Roles, Configuration, Audit Log) sit in a non-wrapping, non-scrolling flex row (`Admin.jsx:981`); at 375px the last tabs are clipped and unreachable.
- Reports' 3-tab bar (`Reports.jsx:113`) is at the same risk margin.
- Compliance AuditsPanel header (`Compliance.jsx:396-407`): non-wrapping flex with descriptive text + wide "PM compliance (12 mo): …" badge + New Audit button → pushed off-screen.
- Maintenance compliance-stub header (`Maintenance.jsx:284`): non-wrapping `gap:20` row of three stat cards + note → overflows.

**Fix**: Tab containers at `Admin.jsx:981` and `Reports.jsx:113`: add `className="tab-strip"` (from TASK-M1.1; horizontal swipe-scroll, no wrap — individual `.tab-btn`s already have `white-space:nowrap`). Header rows at `Compliance.jsx:396` and `Maintenance.jsx:284`: add `flexWrap:'wrap'` (and a `gap` if not present) so items stack on narrow screens.

**Must not break**: Desktop: tabs render in one row with no visible scrollbar interfering (thin scrollbar acceptable); active-tab styling unchanged; header rows show on one line at desktop widths.

**Verify**: At 375px: on /admin, swipe the tab strip to reach "Audit Log" and activate it; /reports tabs all reachable; Compliance audits header and Maintenance compliance tab wrap without horizontal page scroll. At 1440px: single-row layouts unchanged.

### TASK-M2.7: Devices page — empty state and filter chips
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: S
- **Depends on**: none
- **Files**: `apps/app/src/pages/Devices.jsx`

**Problem**: The EmptyState (`Devices.jsx:283-324`) — the first thing users see before provisioning devices — is a two-column `display:flex; gap:40` with a `width:300,flexShrink:0` "How telemetry works" panel, wrapped in `padding:40`; 300 + 40 + 80 > 375 → overflow with the left panel crushed. The status filter chip row (`Devices.jsx:195-207`, 5 chips) has no `flexWrap` and no scroll → overflows.

**Fix**: EmptyState container: add `flexWrap:'wrap'`; on the 300px panel change to `flexBasis:300, flexGrow:1, flexShrink:1, minWidth:260` (drop the hard `width:300,flexShrink:0`) so it wraps to full width on phones; reduce wrapper padding to `clamp(16px, 4vw, 40px)`. Chip row: add `flexWrap:'wrap'`.

**Must not break**: Desktop: two-column empty state and single-row chips unchanged.

**Verify**: At 375px: /devices (with no devices) shows both panels stacked, fully readable; with devices, all 5 chips visible via wrapping; no horizontal scroll. At 1440px: unchanged.

## Wave M3 — Card lists for core work lists

The pattern is defined once in TASK-M3.1 and reused. Principle: at ≤768px hide the `<table>` and render a card list from the same data array with the same click handler as the row; desktop unchanged. Use CSS visibility (`.mobile-cards { display:none }` desktop, shown ≤768px; table wrapper hidden ≤768px) — both render, CSS decides. Cards must be at least 44px tall tap targets.

### TASK-M3.1: Assets card list on mobile
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: L
- **Depends on**: TASK-M2.1
- **Files**: `apps/app/src/pages/Assets.jsx`, `packages/ui/index.css`

**Problem**: The asset list is a 10-column table (AIN, Name & Model, Type, Location, Site, Status, Health, Next Maint., Operator, Actions — `Assets.jsx:1180`, wrapper `:1157`) with `whiteSpace:'nowrap'` cells. On a phone it is only usable via long horizontal scrolling — hostile for the primary daily view. Owner decision: card list on mobile.

**Fix**:
1. In `index.css` add the shared pattern: `.card-list { display:none; }`; inside ≤768px: `.card-list { display:flex; flex-direction:column; gap:8px; padding:12px; overflow-y:auto; } .table-view-desktop { display:none; }` and a `.list-card` style (background `var(--n0)`, border `var(--bdr)`, radius 8, padding 12, full-width tap target).
2. In `Assets.jsx`, wrap the existing table container with `className="table-view-desktop"` (keep its inline styles) and add a sibling `<div className="card-list">` mapping the same filtered/sorted asset array to cards.
3. Card content (top to bottom): row 1 — asset name (600 weight, ellipsis) + `StatusBadge` right-aligned; row 2 — AIN and type (12px, `var(--n400)`); row 3 — location · site; row 4 — health (reuse the same health bar/percent rendering the table row uses, colors from `apps/app/src/lib/health.js`) + next maintenance date right-aligned. Tapping the card calls the same handler as the table row (opens `AssetDetailPanel`, which is a full-screen overlay after TASK-M2.1). Do not add per-card Edit/WO buttons — those actions live in the detail panel.
4. Empty and loading states: the card list must show the same empty/loading treatment the table shows (reuse the existing conditional rendering, not a new one).

**Must not break**: Desktop table untouched (columns, sorting/filtering, row actions). Status filter pills and search continue to drive both views (they filter the same array). Archived toggle and CSV import unaffected.

**Verify**: At 375px: /assets shows cards; search + status pills filter them; tapping a card opens the full-screen detail; no horizontal scroll. At 1440px: the table renders exactly as before and no cards are visible. `npm run build:app` passes.

### TASK-M3.2: Work Orders card list on mobile
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-M2.1, TASK-M3.1
- **Files**: `apps/app/src/pages/WorkOrders.jsx`

**Problem**: The list view is a 9-column table (`WorkOrders.jsx:432`, wrapper `:379`) — same phone problem as Assets. (The kanban Board view already horizontal-scrolls acceptably at `WorkOrders.jsx:402-404`; leave it.)

**Fix**: Reuse the `.card-list`/`.table-view-desktop`/`.list-card` classes from TASK-M3.1. Card content: row 1 — WO ref (mono font) + `StatusBadge`; row 2 — title (ellipsis, 2-line clamp ok); row 3 — priority + asset name; row 4 — due date (highlight overdue the same way the table does). Tap → same handler as the row (opens `WODetail` overlay). Applies to the List view only; Board view unchanged.

**Must not break**: Desktop list table and Board view unchanged; List/Board toggle and status filter pills drive the card list too.

**Verify**: At 375px: /workorders List view shows cards, filters work, tap opens full-screen detail; Board view still horizontally scrolls its columns; no horizontal page scroll in either view. At 1440px: unchanged.

### TASK-M3.3: Maintenance tasks card list on mobile
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-M3.1
- **Files**: `apps/app/src/pages/Maintenance.jsx`

**Problem**: The PM tasks table is 8 columns (`Maintenance.jsx:385`, container `:205`), and its key action — "Mark done" — is a `fontSize:11, padding:0` text button (`Maintenance.jsx:417`), nearly untappable on a phone. Field staff completing PM tasks is a primary mobile use case.

**Fix**: Reuse the card-list pattern. Card content: row 1 — task name + status badge; row 2 — asset name; row 3 — due date (overdue highlighted as the table does) + a real "Mark done" `.btn` (min 44px tall on touch) right-aligned, wired to the same completion handler/modal (`CompleteTaskModal` at `:355` is already mobile-safe). Cards for the PM tab's task table only; the Schedules tab table gets `.table-scroll` treatment in TASK-M4.1 instead.

**Must not break**: Desktop table + inline Mark done unchanged; completion flow (modal, refresh) identical from cards.

**Verify**: At 375px: /maintenance PM tab shows task cards; tapping Mark done opens the completion modal and completing it updates the list; no horizontal scroll. At 1440px: unchanged.

## Wave M4 — Polish batches

### TASK-M4.1: Wrap every remaining data table in `.table-scroll`
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-M1.1
- **Files**: `apps/app/src/pages/Reports.jsx`, `Inspections.jsx`, `Devices.jsx`, `Admin.jsx`, `Compliance.jsx`, `Maintenance.jsx`, `Dashboard.jsx`, `Assets.jsx`, `WorkOrders.jsx` (all under `apps/app/src/pages/`)

**Problem**: The `.table-scroll { overflow-x:auto }` helper (`index.css:321`) is used nowhere. Most tables rely on a parent's `overflowY:'auto'` coercing `overflow-x` to auto — fragile and, after TASK-M1.1 scoped `min-width:560px` to `.table-scroll table`, unscoped tables lose their mobile min-width. Tables inside modals have no scroll wrapper at all and previously overflowed the modal box.

**Fix**: Wrap each `<table>` below in `<div className="table-scroll">` placed as the table's direct parent (inside any existing padded/scrolling container). Complete list:
- `Reports.jsx:138` (library, 8 col)
- `Inspections.jsx:233` (8 col; keep the sticky header working — sticky must be relative to the scroll container)
- `Devices.jsx:222` (9 col)
- `Admin.jsx` users table (`~:712`, container `~:698`) and audit log (`~:854`, container `~:846`)
- `Compliance.jsx` licences (`~:593`, container `~:580`) and audits (`~:422`, container `~:395`)
- `Maintenance.jsx` tasks (`~:385`), schedules (`~:432` SchedulesView), compliance-stub (`~:300`), and the modal table (`~:432` inside the completion/history modal — search for `<table` occurrences in the file and wrap each)
- Normalize the two already-correct inline wrappers to the class: `Assets.jsx:1157` (`overflowX:'auto'` → keep div, add class, drop the inline overflow), `Dashboard.jsx:293`, `WorkOrders.jsx:379` (`overflow:'auto'` — keep vertical behavior: use `className="table-scroll"` plus `overflowY:'auto'` inline), `Admin.jsx:490` (permissions matrix).

**Must not break**: Vertical scrolling of long lists (where the same container scrolls Y, keep `overflowY:'auto'` inline alongside the class). Sticky headers where present.

**Verify**: At 375px: each listed table pans horizontally within its container; no page-level horizontal scroll on /reports, /inspections, /devices, /admin (all tabs), /compliance (both tabs), /maintenance (all tabs). At 1440px: unchanged.

### TASK-M4.2: Stack two-column form grids on small screens
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-M1.1
- **Files**: `apps/app/src/pages/Assets.jsx`, `Compliance.jsx`, `Inspections.jsx`, `Devices.jsx`, `WorkOrders.jsx`, `Maintenance.jsx`, `Settings.jsx`, `Reports.jsx`

**Problem**: Form grids hardcode `gridTemplateColumns:'1fr 1fr'` inline, so fields are ~160px wide inside phone-width modals — cramped labels, clipped values. Inline styles can't be overridden by CSS, so each must be swapped to the `.form-grid` class (TASK-M1.1: 2 columns desktop, 1 column ≤600px).

**Fix**: Replace `style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:N}}` with `className="form-grid"` (keep non-grid inline props; if a grid uses a different gap than the class default, keep `gap` inline). Complete list: `Assets.jsx:298,465,554,975` · `Compliance.jsx:113,135,305,313,324` · `Inspections.jsx:73` · `Devices.jsx:91,103` · `WorkOrders.jsx:90,104,120` · `Maintenance.jsx:68` · `Settings.jsx:146` (LicenceCard — read-only info grid, same treatment) · `Reports.jsx:264` (parameters row). Line numbers may have drifted from Waves M2-M3 — find every `'1fr 1fr'` occurrence in these files (`grep -n "1fr 1fr" apps/app/src/pages/*.jsx`) and convert each; a grid intentionally two-up on mobile is not expected in this app.

**Must not break**: Desktop: two-column layout identical. Field order when stacked = source order (verify date-range pairs still read sensibly stacked).

**Verify**: `grep -rn "'1fr 1fr'" apps/app/src/pages` returns nothing. At 375px: open the Assets add modal, New WO modal, Licence modal — fields stack one per row. At 1440px: two columns as before.

### TASK-M4.3: Touch-target batch — pills, row actions, selects
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-M1.1
- **Files**: `apps/app/src/pages/Assets.jsx`, `Admin.jsx`, `Compliance.jsx`, `WorkOrders.jsx`, `Maintenance.jsx`, `Dashboard.jsx`, `Reports.jsx`, `Inspections.jsx`, `Devices.jsx`, `Notifications.jsx`, `apps/app/src/pages/Auth.jsx`

**Problem**: The `pointer:coarse` rule gives 44px targets only to `.btn/.input/.tab-btn` (`index.css:326-331`). Nearly every filter pill, row action, and select on the work pages is inline-styled at 22-32px and misses it. For gloved field technicians this is the most pervasive usability defect (audit finding MH6).

**Fix**: Add the TASK-M1.1 classes alongside existing inline styles (classes supply only the coarse-pointer min-height; visual styles stay inline):
- `.filter-pill` on status pills: `Assets.jsx:1104`, `Compliance.jsx:562` (row `:554`), `WorkOrders.jsx:362`, and the WorkOrders view toggle `:367`, Devices chips `:195-207`.
- `.row-action` on text-button actions: the `linkBtn` style object (`Assets.jsx:1067`, used at `:1205-1207`), `Admin.jsx:231-232,335-336,432-433,747-749`, `Compliance.jsx:620,440-441,437`, `Maintenance.jsx:417,318`, WorkOrders kebab `:453` and "Move to" buttons `:256`.
- `.select` on inline `<select>`s: `Assets.jsx:1135,1144,852,875`, `Admin.jsx:734-735`, plus the Dashboard header date select.
- Header action buttons currently `height:32` inline on Dashboard/Reports/Inspections/Devices/Compliance/Maintenance: prefer converting to the existing `.btn` class with modifier styles inline; where conversion is risky, add `.row-action`.
- `Auth.jsx:64` show-password button: give it 44×44 hit area (padding), keep the icon size.
Where a `height:N` inline style exists it overrides `min-height` — remove those fixed `height` styles on converted elements and let content + min-height size them (desktop fine pointers are unaffected since the rule is `pointer:coarse` only… note `min-height` beats `height` in CSS conflict? No — inline `height` wins for the used height; REMOVE the inline `height` and set `height:N` in the base class instead so the coarse rule can override).

**Must not break**: Desktop visual appearance (mouse pointers don't match `pointer:coarse`, so desktop sizing must stay identical — that requires the base class to reproduce the removed inline heights exactly: pills 28-30px as today, selects 28px, etc. Set per-element inline `style={{height:...}}` → move to CSS base class once per class).

**Verify**: In devtools with touch emulation (coarse pointer) at 375px: pills, row actions, and selects measure ≥44px tall. With a normal mouse profile at 1440px: heights match pre-change screenshots (28-32px).

### TASK-M4.4: Small-screen leftovers batch
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: none
- **Files**: `apps/app/src/pages/Reports.jsx`, `Onboarding.jsx`, `Auth.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `ForcePasswordChange.jsx`, `NotConfigured.jsx`, `Integrations.jsx`, `Assets.jsx`

**Problem/Fix pairs** (each independent, all inline-style edits):
1. `Reports.jsx:248` template picker `repeat(3,1fr)` → `repeat(auto-fit,minmax(160px,1fr))`.
2. `Onboarding.jsx:238` category picker `repeat(3,1fr)` → `repeat(auto-fit,minmax(140px,1fr))`.
3. `Onboarding.jsx:22-45` StepBar: allow label text to hide on very small screens — wrap labels in a span with a class hidden under `@media (max-width:480px)` (add the rule to `index.css`).
4. `Onboarding.jsx:152,184,234` card `padding:40` → `padding:'clamp(16px, 5vw, 40px)'`; `:197` add-site grid `'1fr 120px'` → `'minmax(0,1fr) 120px'`.
5. Auth-family cards — make width explicit instead of relying on flex-shrink: `Auth.jsx:41` `width:480` → `width:'100%',maxWidth:480`; same change (`maxWidth:440`) in ForgotPassword/ResetPassword/ForcePasswordChange; `NotConfigured.jsx:6` `width:520` → `width:'100%',maxWidth:520`.
6. `Integrations.jsx` toggle (36×20 inline): wrap in a ≥44px hit-area container as in TASK-M2.3 step 3.
7. `Assets.jsx:388` photo-remove ✕ (18×18 at −6px offset): increase to 24×24 visual with padding to ~32px hit area, offset adjusted so it stays tappable next to the 56px thumbnail.

**Must not break**: Desktop appearance of all touched screens (auth cards same rendered width; template/category pickers still 3-up at desktop widths).

**Verify**: At 375px: /reports Generate tab, /onboarding all steps, all four auth pages, /integrations, and the Assets edit modal photo grid — all fully usable, no horizontal scroll. At 1440px: unchanged.

## Wave M5 — PWA + admin-app minimal

### TASK-M5.1: PWA install polish for the staff app
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: none
- **Files**: `apps/app/index.html`, `apps/app/public/manifest.webmanifest` (new), `apps/app/public/` icons (new)

**Problem**: Staff will use the app daily from phones; without a manifest it can't be pinned to the home screen with a proper name/icon. Owner decision: basic install polish only — NO service worker, NO offline mode.

**Fix**:
1. Check `apps/app/index.html` first — it already carries some PWA/apple-mobile meta tags; do not duplicate anything present.
2. Add `apps/app/public/manifest.webmanifest`: `name: "AssetCore"`, `short_name: "AssetCore"`, `start_url: "/"`, `display: "standalone"`, `background_color` and `theme_color` matching the app's neutral background token (read the resolved value of `--n100`/brand color from `packages/ui/index.css` tokens; use the hex equivalents), `icons`: 192×192 and 512×512 PNGs.
3. Generate the two PNGs (and a 180×180 `apple-touch-icon.png`) from the existing app logo/favicon in `apps/app/public/` — if only an SVG/favicon exists, rasterize it centered on the brand background. Place them in `apps/app/public/`.
4. Link in `index.html`: `<link rel="manifest" href="/manifest.webmanifest">` and `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` (if not present).

**Must not break**: No service worker registration anywhere. Vite build must copy `public/` assets as-is (default behavior).

**Verify**: `npm run build:app` passes and `dist/` contains the manifest + icons; in Chromium devtools → Application → Manifest shows name, icons, and "installable" with no errors (ignore the service-worker warning — offline is out of scope).

### TASK-M5.2: Admin-app minimal mobile batch
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: none
- **Files**: `apps/admin/src/pages/OrgDetail.jsx`, `Billing.jsx`, `Support.jsx`, `Login.jsx` (under `apps/admin/src/pages/`)

**Problem**: The admin app is Mantine-based and mostly responsive, with four gaps: (a) OrgDetail's Users/Audit/Billing tab tables are plain `<Table>` without `Table.ScrollContainer` (`OrgDetail.jsx:36,90,113`) — wide content overflows at 375px; (b) Support snapshot tables likewise (`Support.jsx:97,114,131`); (c) `Group grow` rows pack 3 inputs that cannot wrap (`Billing.jsx:89,94,237`, `OrgDetail.jsx:266`) → ~110px inputs on phone; (d) Login `Paper w={400}` (`Login.jsx:36`) overflows a 375px viewport by ~25px.

**Fix**: (a)+(b) wrap each listed `<Table>` in `<Table.ScrollContainer minWidth={560}>` (copy the pattern from `Organizations.jsx:47`). (c) replace each 3-input `<Group grow>` with `<SimpleGrid cols={{ base: 1, sm: 3 }}>` (2-input groups like `OrgDetail.jsx:266` → `cols={{ base: 1, sm: 2 }}`); import `SimpleGrid` from `@mantine/core` if not imported. (d) `Login.jsx:36` → `w="100%" maw={400}` and ensure the wrapping `Center`/container has horizontal padding (`px="md"`).

**Must not break**: Desktop admin layouts unchanged (`sm` breakpoint keeps 3-up rows on desktop). No other admin pages touched.

**Verify**: `npm run build:admin` passes. At 375px: admin login card fits; an org detail page's Users/Audit/Billing tabs pan tables without page overflow; Billing licence editor inputs stack one per row. At 1440px: unchanged.

## Deferred / not planned

- **Kanban board mobile redesign** — horizontal scroll works today (`WorkOrders.jsx:402-404`); revisit only if staff actually use Board view in the field.
- **Offline mode / service worker** — explicitly out of scope per owner decision 3.
- **Full admin-app responsive treatment** — owner decision 1: minimal only (TASK-M5.2).
- **CSV import flow mobile optimization** — the modal fits after Wave M2; import is a desktop task in practice.
- **Functional global search** — the topbar search input is decorative today; TASK-M1.2 keeps it so. Making it work is a feature, not a responsiveness fix.
- **Automated viewport regression tests** — worth doing eventually (Playwright: assert `scrollWidth <= 375` per route), but requires seeded-API test infra beyond this plan's scope; the repo currently has no UI test harness.
