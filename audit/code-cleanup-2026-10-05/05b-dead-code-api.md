# 05b Dead code audit: AssetCore API

Baseline: commit 913e934 on main. Read-only audit of apps/api/src, apps/api/test, db/migrations, scripts/*.mjs.
Callers checked: apps/app/src (tenant portal), apps/admin/src (backoffice), apps/api/test, docs/, deploy/.

Status: complete (all six passes). Generated with grep plus three throwaway Node and Python scripts kept in the session scratchpad, not in the repo.

## Pass 1 and 2: route table with caller match

### How the table was generated

- Mounting read by hand from `apps/api/src/app.ts` (`app.use('/api', apiRouter)`, `app.use('/api', filesRouter)`), `routes/index.ts` (every router mounted at the root of `/api` except `authRouter` at `/auth` and `adminRouter` at `/admin`) and `routes/admin/index.ts` (all admin routers at the root of `/api/admin`). No router uses a sub-path `use()` except `orgMembersRouter.use('/org/members', ...)`, which only adds middleware.
- Endpoints extracted by a Node script that scans `routes/**/*.ts`, `auth/*.ts` and `files.ts` for `<x>Router.(get|post|put|patch|delete)(<string literal>` (multi-line aware) and prefixes by mount point. It found **238** endpoints. Cross-checked with `grep -rhoE "[A-Za-z]+(Router|router)\.(get|post|put|patch|delete)\(" routes auth files.ts | wc -l` = 238. No `router.route()` or computed paths exist.
- Callers: a second script scans `apps/app/src` and `apps/admin/src` for `api|rawApi.(get|post|put|patch|del|upload|download|blobUrl)(<literal>` (every frontend call uses a literal or template literal; `grep` for non-literal calls found none). App paths get `/api` prepended (apps/app/src/lib/apiClient.js:3 BASE); admin paths get `/api/admin` (apps/admin/src/lib/api.js:7-10). Template segments `${x}` match only `:param` segments; ternaries like `${enable ? 'enable' : 'disable'}` are expanded to both values; query strings are stripped. Plus the three hand-coded `fetch` calls (exports download, both refresh calls). Tests: `request(app).<verb>('/api/...')` in `apps/api/test`.
- Then a third pass: when the caller is a helper in `lib/db/*.js`, the helper name is grepped (`grep -rlw`) across its app. A helper used by nobody, or only by a knip-unreachable file (`components/DocumentsPanel.jsx`, `lib/db/documents.js`, `pages/SpareParts.jsx`), does not count as a caller.
- Status values: **USED** (live caller), **HELPER-UNUSED** (a frontend wrapper exists but nothing live calls it), **TEST-ONLY**, **NO CALLER**. External consumers (docs, scripts) are noted in the findings.

Result: 198 USED, 29 HELPER-UNUSED, 4 TEST-ONLY, 7 NO CALLER (of which 2 have an external consumer: /api/health and /api/version).

| Method | Path | Handler | Status | First caller (or note) |
|---|---|---|---|---|
| GET | `/api/admin/admins` | routes/admin/admins.ts:8 | USED | apps/admin/src/pages/Settings.jsx:23 |
| POST | `/api/admin/admins` | routes/admin/admins.ts:19 | USED | apps/admin/src/pages/Settings.jsx:33 |
| PATCH | `/api/admin/admins/:userId` | routes/admin/admins.ts:36 | USED | apps/admin/src/pages/Settings.jsx:41 |
| GET | `/api/admin/audit` | routes/admin/audit.ts:7 | USED | apps/admin/src/pages/PlatformAudit.jsx:10 |
| GET | `/api/admin/billing/invoices` | routes/admin/billing.ts:11 | USED | apps/admin/src/pages/Billing.jsx:121 |
| POST | `/api/admin/billing/invoices` | routes/admin/billing.ts:24 | USED | apps/admin/src/pages/Billing.jsx:136 |
| PATCH | `/api/admin/billing/invoices/:id` | routes/admin/billing.ts:41 | USED | apps/admin/src/pages/Billing.jsx:148 |
| GET | `/api/admin/licence` | routes/admin/licence.ts:16 | USED | apps/admin/src/pages/Billing.jsx:27 |
| PATCH | `/api/admin/licence` | routes/admin/licence.ts:21 | USED | apps/admin/src/pages/Billing.jsx:59 |
| GET | `/api/admin/me` | routes/admin/me.ts:10 | USED | apps/admin/src/lib/AdminAuthContext.jsx:28 |
| GET | `/api/admin/metrics` | routes/admin/metrics.ts:7 | USED | apps/admin/src/pages/Dashboard.jsx:62 |
| GET | `/api/admin/orgs` | routes/admin/orgs.ts:11 | USED | apps/admin/src/App.jsx:58 |
| GET | `/api/admin/orgs/:id` | routes/admin/orgs.ts:29 | USED | apps/admin/src/pages/OrgDetail.jsx:184 |
| POST | `/api/admin/orgs` | routes/admin/orgs.ts:36 | NO CALLER | - |
| PATCH | `/api/admin/orgs/:id` | routes/admin/orgs.ts:49 | USED | apps/admin/src/pages/OrgDetail.jsx:200 |
| POST | `/api/admin/orgs/:id/suspend` | routes/admin/orgs.ts:80 | NO CALLER | - |
| POST | `/api/admin/orgs/:id/restore` | routes/admin/orgs.ts:81 | NO CALLER | - |
| GET | `/api/admin/orgs/:id/usage` | routes/admin/orgs.ts:83 | USED | apps/admin/src/pages/OrgDetail.jsx:58 |
| GET | `/api/admin/orgs/:id/audit` | routes/admin/orgs.ts:93 | USED | apps/admin/src/pages/OrgDetail.jsx:88 |
| GET | `/api/admin/orgs/:id/users` | routes/admin/orgs.ts:101 | USED | apps/admin/src/pages/OrgDetail.jsx:32 |
| GET | `/api/admin/orgs/:id/notes` | routes/admin/orgs.ts:113 | USED | apps/admin/src/pages/OrgDetail.jsx:141 |
| POST | `/api/admin/orgs/:id/notes` | routes/admin/orgs.ts:126 | USED | apps/admin/src/pages/OrgDetail.jsx:147 |
| POST | `/api/admin/support/impersonate` | routes/admin/support.ts:8 | USED | apps/admin/src/pages/Support.jsx:40 |
| GET | `/api/admin/support/org/:id` | routes/admin/support.ts:34 | USED | apps/admin/src/pages/Support.jsx:29 |
| POST | `/api/admin/support/revoke/:id` | routes/admin/support.ts:47 | USED | apps/admin/src/pages/Support.jsx:48 |
| GET | `/api/admin/users` | routes/admin/users.ts:13 | USED | apps/admin/src/pages/Users.jsx:23 |
| PATCH | `/api/admin/users/:id/role` | routes/admin/users.ts:33 | USED | apps/admin/src/pages/Users.jsx:37 |
| POST | `/api/admin/users/:id/disable` | routes/admin/users.ts:60 | USED | apps/admin/src/pages/Users.jsx:46 |
| POST | `/api/admin/users/:id/enable` | routes/admin/users.ts:61 | USED | apps/admin/src/pages/Users.jsx:46 |
| POST | `/api/admin/users/:id/invite` | routes/admin/users.ts:66 | NO CALLER | - |
| POST | `/api/admin/users/:userId/reset-password` | routes/admin/users.ts:105 | USED | apps/admin/src/pages/Users.jsx:54 |
| GET | `/api/admin/version` | routes/admin/version.ts:15 | USED | apps/admin/src/pages/Dashboard.jsx:64 |
| GET | `/api/analytics/kpis` | routes/analytics.ts:47 | USED | apps/app/src/lib/db/analytics.js:12 getKpis() <- apps/app/src/pages/Analytics.jsx |
| GET | `/api/analytics/work-order-trend` | routes/analytics.ts:111 | USED | apps/app/src/lib/db/analytics.js:16 getWorkOrderTrend() <- apps/app/src/pages/Analytics.jsx |
| GET | `/api/analytics/work-order-mix` | routes/analytics.ts:142 | USED | apps/app/src/lib/db/analytics.js:20 getWorkOrderMix() <- apps/app/src/pages/Analytics.jsx |
| GET | `/api/analytics/worst-assets` | routes/analytics.ts:165 | USED | apps/app/src/lib/db/analytics.js:24 getWorstAssets() <- apps/app/src/pages/Analytics.jsx |
| GET | `/api/analytics/asset-map` | routes/analytics.ts:193 | USED | apps/app/src/lib/db/analytics.js:30 getAssetMap() <- apps/app/src/pages/Analytics.jsx,apps/app/src/pages/AssetMapPage.jsx |
| GET | `/api/analytics/calendar` | routes/analytics.ts:240 | USED | apps/app/src/lib/db/analytics.js:34 getCalendar() <- apps/app/src/pages/Calendar.jsx |
| GET | `/api/approval-rules` | routes/approvals.ts:76 | USED | apps/app/src/lib/db/approvals.js:107 listApprovalRules() <- apps/app/src/pages/Approvals.jsx |
| POST | `/api/approval-rules` | routes/approvals.ts:97 | USED | apps/app/src/lib/db/approvals.js:111 createApprovalRule() <- apps/app/src/pages/Approvals.jsx |
| PATCH | `/api/approval-rules/:id` | routes/approvals.ts:125 | USED | apps/app/src/lib/db/approvals.js:115 updateApprovalRule() <- apps/app/src/pages/Approvals.jsx |
| DELETE | `/api/approval-rules/:id` | routes/approvals.ts:172 | USED | apps/app/src/lib/db/approvals.js:119 retireApprovalRule() <- apps/app/src/pages/Approvals.jsx |
| GET | `/api/approvals` | routes/approvals.ts:237 | USED | apps/app/src/lib/db/approvals.js:130 listApprovals() <- apps/app/src/components/SendForApproval.jsx,apps/app/src/pages/WorkOrders.jsx |
| GET | `/api/approvals/stats` | routes/approvals.ts:273 | USED | apps/app/src/lib/db/approvals.js:134 getApprovalStats() <- apps/app/src/pages/Approvals.jsx |
| GET | `/api/approvals/approvers` | routes/approvals.ts:301 | USED | apps/app/src/lib/db/approvals.js:85 listApprovers() <- apps/app/src/components/SendForApproval.jsx |
| GET | `/api/approvals/:id` | routes/approvals.ts:333 | USED | apps/app/src/lib/db/approvals.js:138 getApproval() <- apps/app/src/pages/Approvals.jsx |
| POST | `/api/approvals` | routes/approvals.ts:367 | USED | apps/app/src/lib/db/approvals.js:142 submitApproval() <- apps/app/src/components/SendForApproval.jsx,apps/app/src/pages/WorkOrders.jsx |
| POST | `/api/approvals/:id/approve` | routes/approvals.ts:463 | USED | apps/app/src/lib/db/approvals.js:146 approveRequest() <- apps/app/src/pages/Approvals.jsx |
| POST | `/api/approvals/:id/reject` | routes/approvals.ts:592 | USED | apps/app/src/lib/db/approvals.js:150 rejectRequest() <- apps/app/src/pages/Approvals.jsx |
| POST | `/api/approvals/:id/recall` | routes/approvals.ts:649 | USED | apps/app/src/lib/db/approvals.js:154 recallRequest() <- apps/app/src/pages/Approvals.jsx |
| POST | `/api/approvals/:id/forward` | routes/approvals.ts:767 | USED | apps/app/src/lib/db/approvals.js:89 forwardRequest() <- apps/app/src/pages/Approvals.jsx |
| POST | `/api/approvals/:id/return` | routes/approvals.ts:814 | USED | apps/app/src/lib/db/approvals.js:94 returnRequest() <- apps/app/src/pages/Approvals.jsx |
| POST | `/api/approvals/:id/discard` | routes/approvals.ts:851 | USED | apps/app/src/lib/db/approvals.js:98 discardRequest() <- apps/app/src/pages/Approvals.jsx |
| POST | `/api/approvals/:id/resubmit` | routes/approvals.ts:893 | USED | apps/app/src/lib/db/approvals.js:102 resubmitRequest() <- apps/app/src/components/SendForApproval.jsx,apps/app/src/pages/Approvals.jsx |
| GET | `/api/assets` | routes/assets.ts:156 | USED | apps/app/src/lib/db/assets.js:13 listAssets() <- apps/app/src/components/CompliancePanel.jsx,apps/app/src/components/InspectionsPanel.jsx |
| GET | `/api/assets/by-ain/:ain` | routes/assets.ts:176 | USED | apps/app/src/lib/db/assets.js:72 getAssetByAin() <- apps/app/src/pages/Scan.jsx |
| GET | `/api/assets/:id/health` | routes/assets.ts:193 | USED | apps/app/src/lib/db/assets.js:79 getAssetHealth() <- apps/app/src/pages/Assets.jsx |
| GET | `/api/assets/:id` | routes/assets.ts:199 | HELPER-UNUSED | apps/app/src/lib/db/assets.js:17 getAsset() UNUSED-HELPER; tests: 9 |
| GET | `/api/assets/:id/activity` | routes/assets.ts:209 | USED | apps/app/src/lib/db/assets.js:61 listAssetActivity() <- apps/app/src/pages/Assets.jsx |
| GET | `/api/assets/:id/transfers` | routes/assets.ts:262 | USED | apps/app/src/lib/db/assets.js:95 listAssetTransfers() <- apps/app/src/pages/Assets.jsx |
| POST | `/api/assets/:id/activity` | routes/assets.ts:288 | USED | apps/app/src/lib/db/assets.js:65 addAssetComment() <- apps/app/src/pages/Assets.jsx |
| POST | `/api/assets` | routes/assets.ts:309 | USED | apps/app/src/lib/db/assets.js:21 createAsset() <- apps/app/src/pages/Assets.jsx |
| POST | `/api/assets/import` | routes/assets.ts:360 | USED | apps/app/src/lib/db/assets.js:37 importAssets() <- apps/app/src/pages/Assets.jsx |
| PATCH | `/api/assets/:id` | routes/assets.ts:470 | USED | apps/app/src/lib/db/assets.js:25 updateAsset() <- apps/app/src/pages/Assets.jsx |
| POST | `/api/assets/transfer` | routes/assets.ts:548 | USED | apps/app/src/lib/db/assets.js:86 transferAssets() <- apps/app/src/components/TransferAssetsModal.jsx |
| POST | `/api/assets/:id/photos` | routes/assets.ts:645 | USED | apps/app/src/lib/db/assets.js:43 uploadAssetPhoto() <- apps/app/src/pages/Assets.jsx |
| DELETE | `/api/assets/:id/photos` | routes/assets.ts:676 | USED | apps/app/src/lib/db/assets.js:47 deleteAssetPhoto() <- apps/app/src/pages/Assets.jsx |
| POST | `/api/assets/:id/documents` | routes/assets.ts:697 | USED | apps/app/src/lib/db/assets.js:53 uploadAssetDocument() <- apps/app/src/pages/Assets.jsx |
| DELETE | `/api/assets/:id/documents` | routes/assets.ts:725 | USED | apps/app/src/lib/db/assets.js:57 deleteAssetDocument() <- apps/app/src/pages/Assets.jsx |
| DELETE | `/api/assets/:id` | routes/assets.ts:747 | USED | apps/app/src/lib/db/assets.js:29 softDeleteAsset() <- apps/app/src/pages/Assets.jsx |
| POST | `/api/assets/:id/restore` | routes/assets.ts:762 | USED | apps/app/src/lib/db/assets.js:33 restoreAsset() <- apps/app/src/pages/Assets.jsx |
| GET | `/api/audit-log` | routes/audit.ts:50 | USED | apps/app/src/lib/db/audit.js:10 listAuditLog() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/audit-log/facets` | routes/audit.ts:82 | USED | apps/app/src/lib/db/audit.js:16 auditFacets() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/categories` | routes/categories.ts:22 | USED | apps/app/src/lib/db/categories.js:4 listCategories() <- apps/app/src/pages/Admin.jsx,apps/app/src/pages/Assets.jsx |
| POST | `/api/categories` | routes/categories.ts:29 | USED | apps/app/src/lib/db/categories.js:8 createCategory() <- apps/app/src/pages/Onboarding.jsx,apps/app/src/pages/Admin.jsx |
| PATCH | `/api/categories/:id` | routes/categories.ts:46 | USED | apps/app/src/lib/db/categories.js:12 updateCategory() <- apps/app/src/pages/Admin.jsx |
| DELETE | `/api/categories/:id` | routes/categories.ts:65 | USED | apps/app/src/lib/db/categories.js:16 deleteCategory() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/compliance-licences` | routes/compliance.ts:45 | USED | apps/app/src/lib/db/complianceLicences.js:5 listComplianceLicences() <- apps/app/src/components/CompliancePanel.jsx |
| GET | `/api/compliance-licences/counts` | routes/compliance.ts:64 | HELPER-UNUSED | apps/app/src/lib/db/complianceLicences.js:13 getComplianceLicenceCounts() UNUSED-HELPER |
| GET | `/api/regulatory-authorities` | routes/compliance.ts:82 | USED | apps/app/src/lib/db/complianceLicences.js:58 listAuthorities() <- apps/app/src/components/CompliancePanel.jsx |
| POST | `/api/compliance-licences` | routes/compliance.ts:89 | USED | apps/app/src/lib/db/complianceLicences.js:17 createComplianceLicence() <- apps/app/src/components/CompliancePanel.jsx |
| PATCH | `/api/compliance-licences/:id` | routes/compliance.ts:109 | USED | apps/app/src/lib/db/complianceLicences.js:21 updateComplianceLicence() <- apps/app/src/components/CompliancePanel.jsx |
| POST | `/api/compliance-licences/:id/document` | routes/compliance.ts:127 | USED | apps/app/src/lib/db/complianceLicences.js:31 uploadComplianceDocument() <- apps/app/src/components/CompliancePanel.jsx |
| DELETE | `/api/compliance-licences/:id/documents` | routes/compliance.ts:156 | USED | apps/app/src/lib/db/complianceLicences.js:35 deleteComplianceDocument() <- apps/app/src/components/CompliancePanel.jsx |
| POST | `/api/compliance-audits/:id/document` | routes/compliance.ts:184 | USED | apps/app/src/lib/db/complianceLicences.js:54 uploadAuditDocument() <- apps/app/src/components/CompliancePanel.jsx |
| DELETE | `/api/compliance-audits/:id` | routes/compliance.ts:207 | USED | apps/app/src/lib/db/complianceLicences.js:49 softDeleteComplianceAudit() <- apps/app/src/components/CompliancePanel.jsx |
| DELETE | `/api/compliance-licences/:id` | routes/compliance.ts:218 | USED | apps/app/src/lib/db/complianceLicences.js:25 softDeleteComplianceLicence() <- apps/app/src/components/CompliancePanel.jsx |
| POST | `/api/compliance/check-expiry` | routes/compliance.ts:232 | USED | apps/app/src/lib/db/complianceLicences.js:62 checkLicenceExpiry() <- apps/app/src/components/CompliancePanel.jsx |
| GET | `/api/compliance/pm-compliance` | routes/compliance.ts:245 | USED | apps/app/src/lib/db/complianceLicences.js:75 getPmCompliance() <- apps/app/src/components/CompliancePanel.jsx,apps/app/src/pages/Dashboard.jsx |
| GET | `/api/compliance-audits` | routes/compliance.ts:358 | USED | apps/app/src/lib/db/complianceLicences.js:40 listComplianceAudits() <- apps/app/src/components/CompliancePanel.jsx |
| GET | `/api/compliance-audits/stats` | routes/compliance.ts:375 | NO CALLER | - |
| GET | `/api/compliance-audits/:id` | routes/compliance.ts:394 | USED | apps/app/src/lib/db/complianceLicences.js:121 getComplianceAudit() <- apps/app/src/components/CompliancePanel.jsx |
| POST | `/api/compliance-audits` | routes/compliance.ts:415 | USED | apps/app/src/lib/db/complianceLicences.js:43 createComplianceAudit() <- apps/app/src/components/CompliancePanel.jsx |
| PATCH | `/api/compliance-audits/:id` | routes/compliance.ts:453 | USED | apps/app/src/lib/db/complianceLicences.js:46 updateComplianceAudit() <- apps/app/src/components/CompliancePanel.jsx |
| DELETE | `/api/compliance-audits/:id` | routes/compliance.ts:492 | USED | apps/app/src/lib/db/complianceLicences.js:49 softDeleteComplianceAudit() <- apps/app/src/components/CompliancePanel.jsx |
| POST | `/api/compliance-audits/:id/findings` | routes/compliance.ts:519 | USED | apps/app/src/lib/db/complianceLicences.js:125 addAuditFinding() <- apps/app/src/components/CompliancePanel.jsx |
| PATCH | `/api/compliance-audits/:id/findings/:findingId` | routes/compliance.ts:534 | USED | apps/app/src/lib/db/complianceLicences.js:129 updateAuditFinding() <- apps/app/src/components/CompliancePanel.jsx |
| POST | `/api/compliance-audits/:id/findings/:findingId/defect` | routes/compliance.ts:569 | USED | apps/app/src/lib/db/complianceLicences.js:134 raiseFindingDefect() <- apps/app/src/components/CompliancePanel.jsx |
| GET | `/api/dashboard/stats` | routes/dashboard.ts:12 | USED | apps/app/src/lib/db/dashboard.js:8 getDashboardStats() <- apps/app/src/components/Sidebar.jsx,apps/app/src/pages/Dashboard.jsx |
| GET | `/api/dashboard/alerts` | routes/dashboard.ts:172 | USED | apps/app/src/lib/db/dashboard.js:16 getDashboardAlerts() <- apps/app/src/pages/Dashboard.jsx |
| GET | `/api/dashboard/recent-work-orders` | routes/dashboard.ts:241 | USED | apps/app/src/lib/db/dashboard.js:12 getRecentWorkOrders() <- apps/app/src/pages/Dashboard.jsx |
| GET | `/api/defects` | routes/defects.ts:87 | USED | apps/app/src/lib/db/defects.js:35 listDefects() <- apps/app/src/pages/Defects.jsx |
| GET | `/api/defects/stats` | routes/defects.ts:119 | USED | apps/app/src/lib/db/defects.js:39 getDefectStats() <- apps/app/src/pages/Defects.jsx |
| GET | `/api/defects/:id` | routes/defects.ts:136 | USED | apps/app/src/lib/db/defects.js:43 getDefect() <- apps/app/src/pages/Defects.jsx |
| POST | `/api/defects` | routes/defects.ts:144 | USED | apps/app/src/lib/db/defects.js:47 createDefect() <- apps/app/src/components/InspectionsPanel.jsx,apps/app/src/pages/Defects.jsx |
| PATCH | `/api/defects/:id` | routes/defects.ts:171 | USED | apps/app/src/lib/db/defects.js:51 updateDefect() <- apps/app/src/pages/Defects.jsx |
| POST | `/api/defects/:id/work-order` | routes/defects.ts:224 | USED | apps/app/src/lib/db/defects.js:61 raiseWorkOrder() <- apps/app/src/pages/Defects.jsx |
| DELETE | `/api/defects/:id` | routes/defects.ts:288 | USED | apps/app/src/lib/db/defects.js:55 archiveDefect() <- apps/app/src/pages/Defects.jsx |
| GET | `/api/depreciation/schedules` | routes/depreciation.ts:91 | USED | apps/app/src/lib/db/depreciation.js:13 listSchedules() <- apps/app/src/pages/Depreciation.jsx |
| GET | `/api/depreciation/stats` | routes/depreciation.ts:100 | USED | apps/app/src/lib/db/depreciation.js:17 getDepreciationStats() <- apps/app/src/pages/Depreciation.jsx |
| GET | `/api/depreciation/forecast` | routes/depreciation.ts:121 | USED | apps/app/src/lib/db/depreciation.js:21 getForecast() <- apps/app/src/pages/Depreciation.jsx |
| GET | `/api/depreciation/assets/:assetId` | routes/depreciation.ts:138 | USED | apps/app/src/lib/db/depreciation.js:25 getAssetSchedule() <- apps/app/src/pages/Depreciation.jsx |
| POST | `/api/depreciation/preview` | routes/depreciation.ts:154 | USED | apps/app/src/lib/db/depreciation.js:30 previewSchedule() <- apps/app/src/pages/Depreciation.jsx |
| POST | `/api/depreciation/schedules` | routes/depreciation.ts:182 | USED | apps/app/src/lib/db/depreciation.js:34 createSchedule() <- apps/app/src/pages/Depreciation.jsx |
| POST | `/api/depreciation/schedules/:id/post` | routes/depreciation.ts:294 | USED | apps/app/src/lib/db/depreciation.js:38 postSchedule() <- apps/app/src/pages/Depreciation.jsx |
| POST | `/api/depreciation/post-all` | routes/depreciation.ts:320 | USED | apps/app/src/lib/db/depreciation.js:42 postAllSchedules() <- apps/app/src/pages/Depreciation.jsx |
| DELETE | `/api/depreciation/schedules/:id` | routes/depreciation.ts:342 | USED | apps/app/src/lib/db/depreciation.js:46 retireSchedule() <- apps/app/src/pages/Depreciation.jsx |
| GET | `/api/devices` | routes/devices.ts:48 | USED | apps/app/src/lib/db/devices.js:5 listDevices() <- apps/app/src/pages/Devices.jsx |
| POST | `/api/devices` | routes/devices.ts:63 | USED | apps/app/src/lib/db/devices.js:9 createDevice() <- apps/app/src/pages/Devices.jsx |
| PATCH | `/api/devices/:id` | routes/devices.ts:81 | USED | apps/app/src/lib/db/devices.js:13 updateDevice() <- apps/app/src/pages/Devices.jsx |
| DELETE | `/api/devices/:id` | routes/devices.ts:99 | USED | apps/app/src/lib/db/devices.js:17 softDeleteDevice() <- apps/app/src/pages/Devices.jsx |
| GET | `/api/devices/:id/readings` | routes/devices.ts:113 | HELPER-UNUSED | apps/app/src/lib/db/devices.js:21 getLatestReadings() UNUSED-HELPER |
| GET | `/api/documents` | routes/documents.ts:47 | HELPER-UNUSED | apps/app/src/lib/db/documents.js:18 (in unreachable file) |
| POST | `/api/documents` | routes/documents.ts:62 | HELPER-UNUSED | apps/app/src/lib/db/documents.js:28 (in unreachable file) |
| PATCH | `/api/documents/:id` | routes/documents.ts:114 | HELPER-UNUSED | apps/app/src/lib/db/documents.js:32 (in unreachable file) |
| DELETE | `/api/documents/:id` | routes/documents.ts:138 | HELPER-UNUSED | apps/app/src/lib/db/documents.js:36 (in unreachable file) |
| GET | `/api/escalation-rules` | routes/escalations.ts:71 | USED | apps/app/src/lib/db/escalations.js:32 listEscalationRules() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/escalation-events` | routes/escalations.ts:80 | USED | apps/app/src/lib/db/escalations.js:36 listEscalationEvents() <- apps/app/src/pages/Admin.jsx |
| POST | `/api/escalation-rules` | routes/escalations.ts:94 | USED | apps/app/src/lib/db/escalations.js:40 createEscalationRule() <- apps/app/src/pages/Admin.jsx |
| PATCH | `/api/escalation-rules/:id` | routes/escalations.ts:120 | USED | apps/app/src/lib/db/escalations.js:44 updateEscalationRule() <- apps/app/src/pages/Admin.jsx |
| DELETE | `/api/escalation-rules/:id` | routes/escalations.ts:160 | USED | apps/app/src/lib/db/escalations.js:48 retireEscalationRule() <- apps/app/src/pages/Admin.jsx |
| POST | `/api/escalation-rules/run` | routes/escalations.ts:187 | USED | apps/app/src/lib/db/escalations.js:55 runEscalationsNow() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/exports` | routes/exports.ts:592 | USED | apps/app/src/lib/db/exports.js:8 listExports() <- apps/app/src/pages/Export.jsx |
| GET | `/api/exports/:dataset` | routes/exports.ts:615 | USED | apps/app/src/lib/db/exports.js:21 downloadExport() <- apps/app/src/pages/Admin.jsx,apps/app/src/pages/Export.jsx |
| GET | `/api/health` | routes/health.ts:12 | NO CALLER | - |
| GET | `/api/version` | routes/health.ts:21 | NO CALLER | - |
| GET | `/api/inspections` | routes/inspections.ts:71 | USED | apps/app/src/lib/db/inspections.js:9 listInspections() <- apps/app/src/components/InspectionsPanel.jsx,apps/app/src/pages/Assets.jsx |
| POST | `/api/inspections` | routes/inspections.ts:90 | USED | apps/app/src/lib/db/inspections.js:13 createInspection() <- apps/app/src/components/InspectionsPanel.jsx |
| PATCH | `/api/inspections/:id` | routes/inspections.ts:146 | USED | apps/app/src/lib/db/inspections.js:17 updateInspection() <- apps/app/src/components/InspectionsPanel.jsx,apps/app/src/pages/Assets.jsx |
| POST | `/api/inspections/:id/report` | routes/inspections.ts:239 | USED | apps/app/src/lib/db/inspections.js:23 uploadInspectionReport() <- apps/app/src/components/InspectionsPanel.jsx |
| GET | `/api/inspection-templates` | routes/inspections.ts:292 | USED | apps/app/src/lib/db/inspections.js:57 listInspectionTemplates() <- apps/app/src/components/InspectionsPanel.jsx |
| POST | `/api/inspection-templates` | routes/inspections.ts:302 | HELPER-UNUSED | apps/app/src/lib/db/inspections.js:61 createInspectionTemplate() UNUSED-HELPER |
| PATCH | `/api/inspection-templates/:id` | routes/inspections.ts:328 | HELPER-UNUSED | apps/app/src/lib/db/inspections.js:65 updateInspectionTemplate() UNUSED-HELPER |
| DELETE | `/api/inspection-templates/:id` | routes/inspections.ts:346 | HELPER-UNUSED | apps/app/src/lib/db/inspections.js:69 retireInspectionTemplate() UNUSED-HELPER |
| GET | `/api/inspections/:id` | routes/inspections.ts:361 | HELPER-UNUSED | apps/app/src/lib/db/inspections.js:50 getInspection() UNUSED-HELPER |
| GET | `/api/integrations` | routes/integrations.ts:12 | USED | apps/app/src/lib/db/integrations.js:4 listIntegrations() <- apps/app/src/pages/Integrations.jsx |
| GET | `/api/integrations/:kind` | routes/integrations.ts:19 | HELPER-UNUSED | apps/app/src/lib/db/integrations.js:8 getIntegration() UNUSED-HELPER |
| PUT | `/api/integrations/:kind` | routes/integrations.ts:32 | USED | apps/app/src/lib/db/integrations.js:12 upsertIntegration() <- apps/app/src/pages/Integrations.jsx |
| GET | `/api/integrity/overview` | routes/integrity.ts:79 | USED | apps/app/src/lib/db/integrity.js:15 getIntegrityOverview() <- apps/app/src/pages/Integrity.jsx |
| GET | `/api/licence` | routes/licence.ts:14 | USED | apps/app/src/lib/db/licence.js:4 getLicence() <- apps/app/src/components/LicenceBanner.jsx,apps/app/src/pages/Settings.jsx |
| GET | `/api/locations` | routes/locations.ts:18 | USED | apps/app/src/lib/db/locations.js:4 listLocations() <- apps/app/src/lib/LocationFilterContext.jsx,apps/app/src/pages/Admin.jsx +infile |
| GET | `/api/locations/mine` | routes/locations.ts:39 | USED | apps/app/src/lib/db/locations.js:11 listMyLocations() <- apps/app/src/lib/LocationFilterContext.jsx,apps/app/src/pages/Export.jsx |
| POST | `/api/locations` | routes/locations.ts:58 | USED | apps/app/src/lib/db/locations.js:15 createLocation() <- apps/app/src/pages/Admin.jsx |
| PATCH | `/api/locations/:id` | routes/locations.ts:74 | USED | apps/app/src/lib/db/locations.js:19 updateLocation() <- apps/app/src/pages/Admin.jsx |
| DELETE | `/api/locations/:id` | routes/locations.ts:89 | USED | apps/app/src/lib/db/locations.js:23 softDeleteLocation() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/assets/:id/maintenance-completions` | routes/maintenanceEvents.ts:47 | HELPER-UNUSED | apps/app/src/lib/db/maintenanceEvents.js:4 listMaintenanceCompletions() UNUSED-HELPER |
| POST | `/api/assets/:id/maintenance-completions` | routes/maintenanceEvents.ts:66 | USED | apps/app/src/lib/db/maintenanceEvents.js:14 completeMaintenance() <- apps/app/src/pages/Assets.jsx |
| POST | `/api/maintenance-completions/:id/report` | routes/maintenanceEvents.ts:180 | HELPER-UNUSED | apps/app/src/lib/db/maintenanceEvents.js:20 uploadMaintenanceCompletionReport() UNUSED-HELPER |
| GET | `/api/notifications` | routes/notifications.ts:12 | USED | apps/app/src/lib/db/notifications.js:4 listNotifications() <- apps/app/src/lib/NotificationsContext.jsx |
| GET | `/api/notifications/unread-count` | routes/notifications.ts:23 | USED | apps/app/src/lib/db/notifications.js:8 countUnread() <- apps/app/src/lib/NotificationsContext.jsx |
| POST | `/api/notifications/:id/read` | routes/notifications.ts:31 | USED | apps/app/src/lib/db/notifications.js:13 markRead() <- apps/app/src/lib/NotificationsContext.jsx,apps/app/src/pages/Notifications.jsx |
| POST | `/api/notifications/:id/unread` | routes/notifications.ts:43 | USED | apps/app/src/lib/db/notifications.js:17 markUnread() <- apps/app/src/lib/NotificationsContext.jsx,apps/app/src/pages/Notifications.jsx |
| POST | `/api/notifications/read-all` | routes/notifications.ts:50 | USED | apps/app/src/lib/db/notifications.js:21 markAllRead() <- apps/app/src/lib/NotificationsContext.jsx,apps/app/src/pages/Notifications.jsx |
| GET | `/api/notification-preferences` | routes/notifications.ts:57 | USED | apps/app/src/lib/db/notifications.js:25 getPreferences() <- apps/app/src/pages/Notifications.jsx |
| PUT | `/api/notification-preferences` | routes/notifications.ts:66 | USED | apps/app/src/lib/db/notifications.js:29 upsertPreference() <- apps/app/src/pages/Notifications.jsx |
| GET | `/api/org` | routes/org.ts:23 | USED | apps/app/src/lib/AuthContext.jsx:43 |
| GET | `/api/org/users` | routes/org.ts:36 | USED | apps/app/src/lib/db/orgMembers.js:10 listOrgUsers() <- apps/app/src/components/CompliancePanel.jsx,apps/app/src/components/InspectionsPanel.jsx |
| PATCH | `/api/org` | routes/org.ts:65 | USED | apps/app/src/lib/db/org.js:10 updateOrg() <-  +infile |
| PATCH | `/api/org/settings` | routes/org.ts:106 | USED | apps/app/src/lib/db/org.js:18 updateOrgSettings() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/org/members` | routes/orgMembers.ts:65 | USED | apps/app/src/lib/db/orgMembers.js:4 listOrgMembers() <- apps/app/src/pages/Risks.jsx,apps/app/src/pages/Admin.jsx +infile |
| POST | `/api/org/members/invite` | routes/orgMembers.ts:90 | USED | apps/app/src/lib/db/orgMembers.js:14 inviteOrgMember() <- apps/app/src/pages/Admin.jsx |
| PATCH | `/api/org/members/:id/role` | routes/orgMembers.ts:166 | USED | apps/app/src/lib/db/orgMembers.js:18 updateOrgMemberRole() <- apps/app/src/pages/Admin.jsx |
| PATCH | `/api/org/members/:id/access` | routes/orgMembers.ts:213 | USED | apps/app/src/lib/db/orgMembers.js:24 updateOrgMemberAccess() <- apps/app/src/pages/Admin.jsx |
| POST | `/api/org/members/:id/disable` | routes/orgMembers.ts:300 | USED | apps/app/src/lib/db/orgMembers.js:28 setOrgMemberStatus() <- apps/app/src/pages/Admin.jsx |
| POST | `/api/org/members/:id/enable` | routes/orgMembers.ts:301 | USED | apps/app/src/lib/db/orgMembers.js:28 setOrgMemberStatus() <- apps/app/src/pages/Admin.jsx |
| POST | `/api/org/members/:id/reset-password` | routes/orgMembers.ts:303 | USED | apps/app/src/lib/db/orgMembers.js:32 resetOrgMemberPassword() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/pm-schedules` | routes/pmSchedules.ts:41 | USED | apps/app/src/lib/db/pmSchedules.js:4 listPMSchedules() <- apps/app/src/pages/Maintenance.jsx |
| POST | `/api/pm-schedules` | routes/pmSchedules.ts:52 | USED | apps/app/src/lib/db/pmSchedules.js:8 createPMSchedule() <- apps/app/src/pages/Maintenance.jsx |
| PATCH | `/api/pm-schedules/:id` | routes/pmSchedules.ts:76 | HELPER-UNUSED | apps/app/src/lib/db/pmSchedules.js:12 updatePMSchedule() UNUSED-HELPER |
| DELETE | `/api/pm-schedules/:id` | routes/pmSchedules.ts:94 | USED | apps/app/src/lib/db/pmSchedules.js:16 softDeletePMSchedule() <- apps/app/src/pages/Maintenance.jsx |
| GET | `/api/pm-tasks` | routes/pmTasks.ts:37 | USED | apps/app/src/lib/db/pmTasks.js:11 listPMTasks() <- apps/app/src/pages/Assets.jsx,apps/app/src/pages/Dashboard.jsx |
| PATCH | `/api/pm-tasks/:id` | routes/pmTasks.ts:67 | USED | apps/app/src/lib/db/pmTasks.js:15 updatePMTask() <- apps/app/src/pages/Assets.jsx,apps/app/src/pages/Maintenance.jsx |
| POST | `/api/pm-tasks/:id/report` | routes/pmTasks.ts:174 | USED | apps/app/src/lib/db/pmTasks.js:26 uploadMaintenanceReport() <- apps/app/src/pages/Assets.jsx,apps/app/src/pages/Maintenance.jsx |
| POST | `/api/pm/generate` | routes/pmTasks.ts:212 | USED | apps/app/src/lib/db/pmTasks.js:19 generatePMTasks() <- apps/app/src/pages/Maintenance.jsx |
| GET | `/api/profile` | routes/profile.ts:16 | USED | apps/app/src/pages/Settings.jsx:42 |
| PATCH | `/api/profile` | routes/profile.ts:31 | USED | apps/app/src/pages/Settings.jsx:50 |
| GET | `/api/reports` | routes/reports.ts:25 | TEST-ONLY | -; tests: 2 |
| GET | `/api/reports/location-analytics` | routes/reports.ts:40 | TEST-ONLY | -; tests: 3 |
| POST | `/api/reports` | routes/reports.ts:112 | TEST-ONLY | -; tests: 3 |
| POST | `/api/reports/:id/generate` | routes/reports.ts:137 | TEST-ONLY | -; tests: 1 |
| GET | `/api/risks` | routes/risks.ts:89 | USED | apps/app/src/lib/db/risks.js:63 listRisks() <- apps/app/src/pages/Risks.jsx |
| GET | `/api/risks/matrix` | routes/risks.ts:128 | USED | apps/app/src/lib/db/risks.js:68 getRiskMatrix() <- apps/app/src/pages/Risks.jsx |
| GET | `/api/risks/stats` | routes/risks.ts:170 | USED | apps/app/src/lib/db/risks.js:72 getRiskStats() <- apps/app/src/pages/Risks.jsx |
| GET | `/api/risks/:id` | routes/risks.ts:189 | USED | apps/app/src/lib/db/risks.js:76 getRisk() <- apps/app/src/pages/Risks.jsx |
| POST | `/api/risks` | routes/risks.ts:197 | USED | apps/app/src/lib/db/risks.js:80 createRisk() <- apps/app/src/pages/Risks.jsx |
| PATCH | `/api/risks/:id` | routes/risks.ts:224 | USED | apps/app/src/lib/db/risks.js:84 updateRisk() <- apps/app/src/pages/Risks.jsx |
| DELETE | `/api/risks/:id` | routes/risks.ts:262 | USED | apps/app/src/lib/db/risks.js:88 archiveRisk() <- apps/app/src/pages/Risks.jsx |
| GET | `/api/sites` | routes/sites.ts:26 | USED | apps/app/src/lib/AuthContext.jsx:54 |
| POST | `/api/sites/:id/shutdown` | routes/sites.ts:53 | USED | apps/app/src/lib/db/sites.js:23 shutdownSite() <- apps/app/src/pages/Admin.jsx |
| POST | `/api/sites/:id/reopen` | routes/sites.ts:93 | USED | apps/app/src/lib/db/sites.js:27 reopenSite() <- apps/app/src/pages/Admin.jsx |
| POST | `/api/sites` | routes/sites.ts:132 | USED | apps/app/src/lib/db/sites.js:8 createSite() <- apps/app/src/pages/Onboarding.jsx,apps/app/src/pages/Admin.jsx |
| PATCH | `/api/sites/:id` | routes/sites.ts:163 | USED | apps/app/src/lib/db/sites.js:12 updateSite() <- apps/app/src/pages/Admin.jsx |
| DELETE | `/api/sites/:id` | routes/sites.ts:182 | USED | apps/app/src/lib/db/sites.js:16 softDeleteSite() <- apps/app/src/pages/Admin.jsx |
| GET | `/api/spare-parts` | routes/spareParts.ts:47 | USED | apps/app/src/lib/db/spareParts.js:21 listSpareParts() <- apps/app/src/pages/WorkOrders.jsx |
| GET | `/api/spare-parts/stats` | routes/spareParts.ts:72 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:29 getPartStats() UNUSED-HELPER |
| GET | `/api/spare-parts/categories` | routes/spareParts.ts:87 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:33 listPartCategories() UNUSED-HELPER |
| GET | `/api/spare-parts/:id` | routes/spareParts.ts:97 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:25 getSparePart() UNUSED-HELPER |
| POST | `/api/spare-parts` | routes/spareParts.ts:125 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:37 createSparePart() UNUSED-HELPER |
| PATCH | `/api/spare-parts/:id` | routes/spareParts.ts:164 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:41 updateSparePart() UNUSED-HELPER |
| DELETE | `/api/spare-parts/:id` | routes/spareParts.ts:187 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:45 archiveSparePart() UNUSED-HELPER |
| POST | `/api/spare-parts/:id/adjust` | routes/spareParts.ts:215 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:50 adjustStock() UNUSED-HELPER |
| GET | `/api/spare-parts/:id/movements` | routes/spareParts.ts:264 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:54 listMovements() UNUSED-HELPER |
| POST | `/api/spare-parts/:id/assets` | routes/spareParts.ts:281 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:58 linkPartToAsset() UNUSED-HELPER |
| DELETE | `/api/spare-parts/:id/assets/:assetId` | routes/spareParts.ts:295 | HELPER-UNUSED | apps/app/src/lib/db/spareParts.js:62 unlinkPartFromAsset() UNUSED-HELPER |
| GET | `/api/work-orders` | routes/workOrders.ts:120 | USED | apps/app/src/lib/db/workOrders.js:57 listWorkOrders() <- apps/app/src/components/Topbar.jsx,apps/app/src/pages/WorkOrders.jsx |
| GET | `/api/work-orders/:id` | routes/workOrders.ts:135 | USED | apps/app/src/lib/db/workOrders.js:61 getWorkOrder() <- apps/app/src/pages/WorkOrders.jsx |
| POST | `/api/work-orders` | routes/workOrders.ts:334 | USED | apps/app/src/lib/db/workOrders.js:65 createWorkOrder() <- apps/app/src/pages/WorkOrders.jsx,apps/app/src/pages/Assets.jsx |
| PATCH | `/api/work-orders/:id` | routes/workOrders.ts:379 | USED | apps/app/src/lib/db/workOrders.js:69 updateWorkOrder() <- apps/app/src/pages/WorkOrders.jsx |
| POST | `/api/work-orders/:id/transition` | routes/workOrders.ts:482 | USED | apps/app/src/lib/db/workOrders.js:73 transitionWorkOrder() <- apps/app/src/pages/WorkOrders.jsx |
| POST | `/api/work-orders/:id/attachments` | routes/workOrders.ts:585 | USED | apps/app/src/lib/db/workOrders.js:87 uploadWorkOrderAttachment() <- apps/app/src/pages/WorkOrders.jsx |
| POST | `/api/work-orders/:id/comments` | routes/workOrders.ts:634 | USED | apps/app/src/lib/db/workOrders.js:77 addWorkOrderComment() <- apps/app/src/pages/WorkOrders.jsx |
| DELETE | `/api/work-orders/:id` | routes/workOrders.ts:649 | HELPER-UNUSED | apps/app/src/lib/db/workOrders.js:81 softDeleteWorkOrder() UNUSED-HELPER |
| GET | `/api/work-orders/:id/tasks` | routes/workOrders.ts:672 | HELPER-UNUSED | apps/app/src/lib/db/workOrders.js:91 listWorkOrderTasks() UNUSED-HELPER |
| POST | `/api/work-orders/:id/tasks` | routes/workOrders.ts:685 | USED | apps/app/src/lib/db/workOrders.js:95 addWorkOrderTask() <- apps/app/src/pages/WorkOrders.jsx |
| PATCH | `/api/work-orders/:id/tasks/:taskId` | routes/workOrders.ts:705 | USED | apps/app/src/lib/db/workOrders.js:99 updateWorkOrderTask() <- apps/app/src/pages/WorkOrders.jsx |
| DELETE | `/api/work-orders/:id/tasks/:taskId` | routes/workOrders.ts:736 | USED | apps/app/src/lib/db/workOrders.js:103 deleteWorkOrderTask() <- apps/app/src/pages/WorkOrders.jsx |
| GET | `/api/work-orders/:id/parts` | routes/workOrders.ts:756 | HELPER-UNUSED | apps/app/src/lib/db/workOrders.js:108 listWorkOrderParts() UNUSED-HELPER |
| POST | `/api/work-orders/:id/parts` | routes/workOrders.ts:772 | USED | apps/app/src/lib/db/workOrders.js:112 addWorkOrderPart() <- apps/app/src/pages/WorkOrders.jsx |
| PATCH | `/api/work-orders/:id/parts/:lineId` | routes/workOrders.ts:806 | HELPER-UNUSED | apps/app/src/lib/db/workOrders.js:116 updateWorkOrderPart() UNUSED-HELPER |
| DELETE | `/api/work-orders/:id/parts/:lineId` | routes/workOrders.ts:842 | USED | apps/app/src/lib/db/workOrders.js:120 deleteWorkOrderPart() <- apps/app/src/pages/WorkOrders.jsx |
| POST | `/api/auth/login` | auth/routes.ts:113 | USED | apps/app/src/lib/auth.js:89 signIn() <- apps/app/src/pages/Auth.jsx |
| POST | `/api/auth/refresh` | auth/routes.ts:144 | USED | apps/app/src/lib/apiClient.js:46 in local:refresh |
| POST | `/api/auth/logout` | auth/routes.ts:171 | USED | apps/app/src/lib/auth.js:100 signOut() <- apps/app/src/components/Topbar.jsx,apps/app/src/lib/AuthContext.jsx |
| GET | `/api/auth/me` | auth/routes.ts:185 | USED | apps/app/src/lib/auth.js:55 getSession() <- apps/app/src/lib/AuthContext.jsx +infile |
| POST | `/api/auth/forgot-password` | auth/routes.ts:208 | USED | apps/app/src/pages/ForgotPassword.jsx:24 |
| POST | `/api/auth/reset-password` | auth/routes.ts:237 | USED | apps/app/src/pages/ResetPassword.jsx:33 |
| POST | `/api/auth/change-password` | auth/routes.ts:261 | USED | apps/app/src/pages/ForcePasswordChange.jsx:30 |
| GET | `/api/files/*filePath` | files.ts:145 | USED | apps/app/src/components/AuthImage.jsx:12 |

Note: the table lists `DELETE /api/compliance-audits/:id` twice. That is real, not a script artefact; see DC-API-01.

### Pass 2 findings: endpoints without a live caller

**DC-API-01. Duplicate route, second handler unreachable.**
- File: apps/api/src/routes/compliance.ts:207 and apps/api/src/routes/compliance.ts:492, both `complianceRouter.delete('/compliance-audits/:id', ...)`.
- Evidence: `cut -f1,2 routes.tsv | sort | uniq -d` returns exactly this one pair. Express runs the first match, so lines 492-509 never run.
- The two are not identical. The live one (207) archives with `where id = $1` and writes an audit row even when the audit is already archived. The dead one (492) adds `and deleted_at is null`, so a second delete 404s and no duplicate audit entry is written. The dead copy is the better one.
- Classification: DELETE one copy. Recommend deleting lines 207-216 so the stricter handler takes over (small behaviour change: deleting an already-archived audit returns 404 instead of 204). Confidence: high.

**DC-API-02. Reports API is test-only since the Export rewrite.**
- Endpoints: GET /api/reports (reports.ts:25), GET /api/reports/location-analytics (:40), POST /api/reports (:112), POST /api/reports/:id/generate (:137).
- Evidence: zero callers in apps/app/src or apps/admin/src. Commit 913e934 deleted apps/app/src/pages/Reports.jsx and apps/app/src/lib/db/reports.js and made `/reports` redirect to `/export` (apps/app/src/App.jsx:167). Only callers: apps/api/test/uatRound2.test.ts:39-62 (capability gating and a book-value redaction check on location-analytics) and apps/api/test/uatRound3.test.ts:94-130.
- What would go with it: routes/reports.ts (173 lines), `buildReportData`, `REPORT_KINDS` and `ReportKind` in apps/api/src/reportBuilders.ts:5-139 (about 135 lines; `renderCsv`, `renderXlsx` and `localDateStamp` stay because exports.ts uses them), the `reports` file resolver at files.ts:138, two lines in routes/index.ts, and those tests.
- Data: the `public.reports` table and any files under FILES_DIR/{org}/reports/ may hold generated reports from before 913e934. The files resolver is the only way to download them.
- Classification: OWNER DECISION (truly dead from the UI, but stored report files and the location-analytics rollup may be wanted). Confidence: high that there is no UI caller.

**DC-API-03. Spare parts API: whole module unwired (UI replaced with "coming soon").**
- Endpoints: 11 of 12 routes in apps/api/src/routes/spareParts.ts (stats, categories, get, create, patch, delete, adjust, movements, link/unlink asset). Only GET /api/spare-parts is live, via `listSpareParts()` in apps/app/src/pages/WorkOrders.jsx (the part picker for work order part lines).
- Evidence: the helpers in apps/app/src/lib/db/spareParts.js are imported only by apps/app/src/pages/SpareParts.jsx, which knip reports as an unused file. App.jsx:151 routes `/spare-parts` to `ComingSoon` ("Warehouse Inventory"), and Sidebar.jsx:55 marks it `soon`. Commit 913e934 says spare parts is being reworked into warehouse inventory.
- Related: the `check_low_stock` cron job (jobs.ts) still runs daily against spare_parts, and POST /api/work-orders/:id/parts (live) draws stock from it.
- Classification: OWNER DECISION. This is a parked feature, not dead code. If the warehouse rework replaces it, routes/spareParts.ts (300 lines less the list handler), SpareParts.jsx and spareParts.js go together. Confidence: high.

**DC-API-04. Generic documents API: ported but never mounted, and its files cannot be downloaded.**
- Endpoints: GET/POST /api/documents, PATCH/DELETE /api/documents/:id (apps/api/src/routes/documents.ts, 159 lines).
- Evidence: the only caller is apps/app/src/lib/db/documents.js, used only by apps/app/src/components/DocumentsPanel.jsx. knip reports both as unused files. `git log -S"<DocumentsPanel"` finds no commit that ever rendered the panel: it arrived in 5a413fa ("port the new pages") and was never mounted.
- Second problem: POST /api/documents stores files under `documents/` (routes/documents.ts:80, `uploadTo('documents')`), but `FILE_OWNERSHIP_CHECKS` in apps/api/src/files.ts:126-139 has no `documents` entry, so GET /api/files/documents/... always returns 404 (default-deny, files.ts:158). Even if the panel were mounted, uploaded files could not be opened.
- Overlap: assets already carry documents through POST/DELETE /api/assets/:id/documents (live, Assets.jsx:422/432) stored in `assets.documents` jsonb, not in the `public.documents` table.
- Classification: OWNER DECISION (keep and finish, meaning mount the panel and add a resolver; or delete the route, panel, helper and eventually the table). Confidence: high.

**DC-API-05. Platform console endpoints with no UI, kept on purpose.**
- POST /api/admin/orgs (admin/orgs.ts:36-47), POST /api/admin/orgs/:id/suspend and /restore (admin/orgs.ts:65-81).
- Evidence: no caller in apps/admin/src. Commit a6e993f removed the create-org and suspend controls from the UI and says the "endpoints kept for DB-runbook use". No doc mentions them (`grep -rni suspend docs/` is empty), so the runbook use is not written down anywhere.
- Classification: KEEP (documented intent in the commit), but add a line to docs/OPERATIONS.md or delete. OWNER DECISION. About 29 lines. Confidence: high.

**DC-API-06. POST /api/admin/users/:id/invite: never had a caller.**
- File: apps/api/src/routes/admin/users.ts:63-101 (39 lines).
- Evidence: no caller in apps/admin/src, and `git log -S invite -- apps/admin/src` is empty, so no admin UI ever called it. The `:id` path param is ignored (everything comes from the body). Tenant invites go through POST /api/org/members/invite, which is live.
- Aside for the security pass (not dead code): its upsert `on conflict (email) do update set email = excluded.email` attaches an existing user to the target org.
- Classification: DELETE (or OWNER DECISION if the support team uses it with curl). Confidence: medium-high.

**DC-API-07. Single endpoints whose frontend helper exists but is never called.**

| Endpoint | Handler | Unused helper | Test callers | Note |
|---|---|---|---|---|
| GET /api/assets/:id | assets.ts:199-205 | `getAsset` (assets.js:17) | 9 | Tests use it heavily; a natural REST read. KEEP. |
| GET /api/compliance-licences/counts | compliance.ts:64-80 | `getComplianceLicenceCounts` (complianceLicences.js:13) | 0 | No screen calls it. DELETE candidate. |
| GET /api/compliance-audits/stats | compliance.ts:375-392 | none at all | 0 | No helper and no caller. DELETE candidate. |
| GET /api/devices/:id/readings | devices.ts:113-122 | `getLatestReadings` (devices.js:21) | 0 | Reads `telemetry_readings`, which nothing ever writes (DC-API-14). OWNER DECISION (IoT). |
| POST/PATCH/DELETE /api/inspection-templates | inspections.ts:302-357 | create/update/retireInspectionTemplate (inspections.js:61-69) | 0 | GET is live (template picker). No screen manages templates. OWNER DECISION (unwired admin UI). |
| GET /api/inspections/:id | inspections.ts:361-378 | `getInspection` (inspections.js:50) | 0 | List payload is used instead. DELETE candidate (low value either way). |
| GET /api/integrations/:kind | integrations.ts:19-24 | `getIntegration` (integrations.js:8) | 0 | List and PUT are live. DELETE candidate. |
| GET /api/assets/:id/maintenance-completions | maintenanceEvents.ts:47-60 | `listMaintenanceCompletions` (maintenanceEvents.js:4) | 0 | POST is live. No history view. OWNER DECISION. |
| POST /api/maintenance-completions/:id/report | maintenanceEvents.ts:179-221 | `uploadMaintenanceCompletionReport` (maintenanceEvents.js:20) | 0 | "Replace report later" flow never wired. OWNER DECISION. |
| PATCH /api/pm-schedules/:id | pmSchedules.ts:76-92 | `updatePMSchedule` (pmSchedules.js:12) | 0 | Maintenance.jsx only creates and deletes schedules, so a schedule cannot be edited in the UI. OWNER DECISION (likely a missing feature, not dead). |
| DELETE /api/work-orders/:id | workOrders.ts:649-661 | `softDeleteWorkOrder` (workOrders.js:81) | 0 | No delete button. OWNER DECISION. |
| GET /api/work-orders/:id/tasks | workOrders.ts:672-683 | `listWorkOrderTasks` (workOrders.js:91) | 0 | Tasks arrive embedded in GET /work-orders/:id. DELETE candidate. |
| GET /api/work-orders/:id/parts | workOrders.ts:756-770 | `listWorkOrderParts` (workOrders.js:108) | 0 | Same: parts are embedded in the detail payload. DELETE candidate. |
| PATCH /api/work-orders/:id/parts/:lineId | workOrders.ts:806-840 | `updateWorkOrderPart` (workOrders.js:116) | 0 | UI adds and removes lines but never edits one. OWNER DECISION. |

Evidence for every row: the helper name grepped with `grep -rlw <name> apps/app/src` returns only its own file. This matches knip's unused-export list.

**DC-API-08. GET /api/health and GET /api/version (routes/health.ts:12, :21): no frontend caller, external consumers exist. KEEP.**
- Evidence: docs/OPERATIONS.md:55-56, docs/DEPLOYMENT.md:126 and scripts/support-bundle.mjs:66-67 call them. The admin console uses its own /api/admin/version (Dashboard.jsx:64). Neither deploy/docker-compose.yml nor deploy/nginx/nginx.conf uses /api/health; the compose healthcheck is only `pg_isready` on postgres, and the api service has none. Wiring `/api/health` into a compose healthcheck would be a cheap ops improvement.

## Pass 3: modules and tests

**Reachability.** A Node walk of relative imports starting at apps/api/src/index.ts reaches 72 of the 76 `.ts` files under apps/api/src. The four it does not reach are the three colocated unit tests (`depreciation.test.ts`, `health.test.ts`, `kpis.test.ts`) and `types/express.d.ts` (an ambient declaration picked up by tsconfig `include: ["src"]`). **No dead source module.** tsconfig excludes `src/**/*.test.ts` from the build, and `apps/api/dist` contains no test files.

**DC-API-09. The three "health" files are three different things. None is dead or duplicated, but the names collide.**
- apps/api/src/health.ts (239 lines): pure asset health scoring (`computeHealth`, `HEALTH_WEIGHTS`, `DEFECT_PENALTY`), with no DB access. Imported by healthService.ts:28 and src/health.test.ts.
- apps/api/src/healthService.ts (226 lines): the DB layer around it. It loads signals, then `previewAssetHealth` (GET /api/assets/:id/health), `refreshAssetHealth` (called from 7 route files after writes), and `recomputeAllHealthScores` (the 01:00 cron job). It writes through SQL `apply_asset_health()`.
- apps/api/src/routes/health.ts (32 lines): the service liveness probe GET /api/health and GET /api/version. It has nothing to do with asset health.
- Recommendation: KEEP all three. Optionally rename routes/health.ts to routes/system.ts (or `status.ts`) so "health" means one thing. That is a refactor item, not a deletion.
- Small dead branch: `recomputeAllHealthScores(c, orgId?)` (healthService.ts:188). The only caller (jobs.ts:24) never passes `orgId`, so the `if (orgId)` branch at :196-199 never runs. UNEXPORT/KEEP. Trivial, 4 lines.

**DC-API-10. Unit vs integration tests: distinct coverage, not duplicates. KEEP both pairs.**
- src/health.test.ts (20 tests): pure unit tests of `computeHealth()` (weights, missing evidence, severity penalties, age).
- test/health.test.ts (11 tests): integration tests against Postgres covering threshold crossings that create Auto inspections and draft work orders, synchronous recompute on PATCH and create, and maintenance completion moving the window. **Exception:** its first test, "decay math" (test/health.test.ts:43-58), calls the legacy SQL `public.recompute_asset_health($1)`, which production no longer runs (see DC-API-12). It exercises a code path that has been dead since the five-signal engine replaced linear decay. Recommend deleting that one test, or repointing it at `recomputeAllHealthScores`.
- src/depreciation.test.ts (18 tests): unit tests of the TypeScript `buildSchedule()` and `postedBookValue()` (the posted depreciation subledger in apps/api/src/depreciation.ts).
- test/depreciation.test.ts (11 tests): integration tests of SQL `public.recompute_asset_depreciation_for()` (the derived `assets.nbv_cents` and `accumulated_depreciation_cents` that the 02:00 cron maintains).
- These cover **two different depreciation engines**, one in TypeScript (schedules) and one in SQL (nightly book value). The tests are not duplicates, but two calculators of the same quantity are a drift risk. That belongs in the refactor audit (05d), not here.

## Pass 4: jobs, SQL functions, tables, columns

**Scheduled jobs (apps/api/src/jobs.ts:16-35).** All eight exist and are current:

| Job | Schedule (TZ from config) | Calls | Latest definition |
|---|---|---|---|
| mark_overdue_pm_tasks | 00:05 | `public.mark_overdue_pm_tasks()` | 0027 |
| recompute_asset_health | 01:00 | TypeScript `recomputeAllHealthScores` (not the SQL function of the same name) | n/a |
| recompute_asset_depreciation | 02:00 | `public.recompute_asset_depreciation()` | 0015 |
| generate_pm_tasks | 06:00 | `public.generate_pm_tasks()` | 0027 |
| check_low_stock | 06:30 | `public.check_low_stock()` | 0022 |
| notify_pm_due | 06:30 | `public.notify_pm_due()` | 0027 |
| check_licence_expiry | 07:00 | `public.check_licence_expiry()` | 0010 |
| run_escalations | 07:15 | `public.run_escalations()` | 0027 |

The job named `recompute_asset_health` shares its name with a SQL function it no longer calls, which makes greps misleading. Consider renaming it `rescore_asset_health`.

**SQL functions.** Method: a Python script parsed every `create [or replace] function` across db/migrations (26 distinct functions). For each one it counted references in apps/api/src, apps/api/test (excluding tmp), scripts, trigger bindings (`execute function`), and other SQL bodies (excluding definition, grant, revoke and comment lines). Comment-only API hits were then removed by grepping for a real call `name(`.

| Function | Live caller | Status |
|---|---|---|
| apply_asset_health | healthService.ts:167 | live |
| check_licence_expiry, check_low_stock, generate_pm_tasks, mark_overdue_pm_tasks, notify_pm_due, run_escalations, recompute_asset_depreciation | jobs.ts (plus compliance.ts:234 and pmTasks.ts:214 for manual runs) | live |
| recompute_asset_depreciation_for | assets.ts:146, :512 | live |
| current_org_id, current_user_id, current_site_ids | RLS policies plus API SQL | live |
| current_role_key | RLS policy 0001:890-891 | live (SQL only) |
| is_platform_admin | RLS policy 0001:995 | live (SQL only) |
| is_work_suspended, is_entity_work_suspended | other 0027 functions | live (SQL only) |
| next_wo_ref | workOrders.ts:190 | live |
| notify_users, notify_role_holders | notify.ts:27, :50 | live |
| resolve_audit_label | audit.ts:26 | live |
| risk_band | integrity.ts:157-159 | live |
| set_updated_at, notify_wo_activity | triggers | live |
| **licence_status(date)** | none | **DC-API-11** |
| **recompute_asset_health(uuid)** | seed-dev.mjs:266 and test/health.test.ts:54 only | **DC-API-12** |
| **recompute_asset_health_for(uuid, uuid)** | only from recompute_asset_health | **DC-API-12** |

**DC-API-11. `public.licence_status(date)` is never called.** Defined at db/migrations/0001_baseline.sql:519 and granted at :1067. The only other mention is a comment at 0024:81. No API, test, script, policy, view or function calls it. Classification: DELETE through a new forward migration (`drop function if exists public.licence_status(date);`). Migrations are append-only, so no lines leave the baseline. Confidence: high.

**DC-API-12. Legacy linear-decay health functions.** `recompute_asset_health(uuid)` (latest at 0027:284) and `recompute_asset_health_for(uuid, uuid)` (0016:160) were replaced by the TypeScript engine. healthService.ts:10 and assets.ts:136 and :499 say so in comments, and jobs.ts calls the TypeScript version. Remaining callers: scripts/seed-dev.mjs:266, which means a dev seed scores health with the old formula and so differs from production, and the "decay math" test in test/health.test.ts:43-58. Classification: OWNER DECISION. Recommend switching seed-dev.mjs to the TypeScript path (or simply letting the first nightly run fix it), deleting the decay-math test, then dropping both functions in a forward migration. Confidence: high that production does not use them.

**Tables.** Method: the script parsed 55 `create table` statements and searched apps/api/src for `public.<t>`, `from|join|into|update <t>`. Every table has an API reference except:
- `telemetry_readings_2026` and `telemetry_readings_2027`: partitions of `telemetry_readings`, reached through the parent. Fine. Note that no partition exists past 2027 (an ops item, out of scope).
- `wo_ref_counters`: used only inside `next_wo_ref()`. Fine.
- **`sms_log` (DC-API-13):** never read or written by anything. The only references are its create table, RLS enable and select policy (0001:727, :874, :981). It is from the old SMS (Termii) plan. Classification: OWNER DECISION. Check row count (`select count(*) from public.sms_log`) on each client instance before a drop migration. Confidence: high.
- **`telemetry_readings` (DC-API-14):** read by GET /api/devices/:id/readings (whose frontend helper is unused, DC-API-07), but nothing writes it. There is no ingestion endpoint (integrations.ts:49 says connector wiring is commissioned per client). Devices CRUD is live. Classification: OWNER DECISION (IoT roadmap). Do not drop.
- `integrations`: written and listed by the API, but no code reads `config` to act on it. It is a settings store with no consumer, by design per integrations.ts. KEEP. Aside for the security audit: PUT /api/integrations/:kind has no `requireCap`, so any active member can overwrite integration config.
- `reports`: only touched by the test-only Reports API (DC-API-02).
- `documents`: only touched by the unmounted documents API (DC-API-04).

**Columns (sampled).** Method: the script parsed column lists from every `create table` and `alter table ... add column` (671 columns, renames and drops applied). It flagged columns whose name appears nowhere in apps/api/src, apps/app/src, apps/admin/src or scripts. This catches only distinctively named columns: common names like `status` or `name` always match something, so this is a lower bound, not a full sweep. 15 flagged. After reading each one:

| Column | Finding |
|---|---|
| **documents.mime_type** (0021:123) | Never written. The API writes `content_type` instead (documents.ts:85). Dead duplicate column. **DC-API-15**, drop together with whatever is decided for DC-API-04. |
| **pm_schedules.interval_days, pm_schedules.checklist_template** (0022:389-398) | Read by `generate_pm_tasks()` (0027:430-455), but no API schema or UI sets them, so they are always null or `[]`. **DC-API-16**: an unwired feature (custom PM intervals and checklist templates). OWNER DECISION. |
| **asset_categories.salvage_rate_pct** (0021:77) | Read by depreciation SQL (0022:282), never settable from the API or UI. Same pattern. **DC-API-16**. |
| sms_log.* (4 columns) | See DC-API-13. |
| telemetry_readings.reading_type, quality | See DC-API-14. |
| notifications.dedupe_key, wo_ref_counters.next_seq, escalation_events.notified_count | Written and read inside SQL functions. Live. |
| regulatory_authorities.jurisdiction, sector | Seeded at 0001:488. GET /api/regulatory-authorities selects only `id, name, code` (compliance.ts:84), so nothing reads them. Low-value reference data. KEEP (no action). |

## Pass 5: inside the code

### DC-API-17. knip "unused exports" in apps/api, verified one by one

Method: `grep -rnw <symbol> apps/api/src apps/api/test` for each symbol. "In-file refs" means the symbol is used inside its own module, so only the `export` keyword is dead.

| Symbol | Defined at | Refs | Classification |
|---|---|---|---|
| `mailerConfigured` | auth/mailer.ts:8 | 0 outside the definition | **DELETE** (4 lines with its comment). Its comment says routes would use it to tell the UI the truth, but `sendMail()` now returns `{ delivered }` and callers use that. |
| `NO_SITE` | auth/routes.ts:46 | used at :92 | UNEXPORT |
| `sniffMime` | files.ts:58 | used at :79 | UNEXPORT |
| `DEFECT_PENALTY` | health.ts:35 | used at :136 | UNEXPORT (or KEEP if a test should pin it; none does today) |
| `recomputeAssetHealth` | healthService.ts:171 | used at :225 by `refreshAssetHealth` | UNEXPORT |
| `hasCap` (platform) | middleware/platformRbac.ts:15 | used at :24 | UNEXPORT. It also shares its name with middleware/rbac.ts `hasCap(req, cap)`, which has a different signature. |
| `ROLE_CAPABILITIES` | middleware/rbac.ts:7 (re-export of @assetcore/rbac) | no importer through rbac.ts | Remove from the re-export list. `can`, `GRANTABLE_CAPS` and `ROLE_KEYS` are used (approvals.ts:8, orgMembers.ts:10, documents.ts:8). |
| `APPROVAL_ENTITY_TYPES`, `APPROVAL_KINDS` | routes/approvals.ts:23, :27 | in-file (zod enums :65-66, :344-346) | UNEXPORT |
| `DEPRECIATION_METHODS` | routes/assets.ts:61 | in-file (:104) | UNEXPORT. Note there is a **second, different** `DEPRECIATION_METHODS` in apps/api/src/depreciation.ts:10 (no `'none'`), used by routes/depreciation.ts. Same name, different contents. Rename the asset one (e.g. `ASSET_DEPRECIATION_METHODS`). |
| `LIFECYCLE_STATUSES`, `CRITICALITIES` | routes/assets.ts:62-63 | in-file | UNEXPORT |
| `AUDIT_KINDS`, `AUDIT_OUTCOMES`, `FINDING_SEVERITIES` | routes/compliance.ts:282-284 | in-file | UNEXPORT |
| `DEFECT_SEVERITIES`, `DEFECT_STATUSES` | routes/defects.ts:17-18 | in-file | UNEXPORT |
| `ESCALATION_ENTITY_TYPES`, `ESCALATION_TRIGGERS`, `VALID_TRIGGERS` | routes/escalations.ts:16, :19, :25 | in-file | UNEXPORT |
| `INSPECTION_KINDS`, `CHECKLIST_RESULTS` | routes/inspections.ts:29-30 | in-file | UNEXPORT |
| `INTEGRITY_STATUSES`, `integrityStatusOf` | routes/integrity.ts:19, :48 | in-file | UNEXPORT (`integrityStatusOf` is pure and a good unit-test target; KEEP exported if a test is added) |
| `RISK_CATEGORIES`, `RISK_STATUSES` | routes/risks.ts:16-17 | in-file | UNEXPORT |
| types `DirectSubmit`, `TokenKind`, `PeriodEntry`, `HealthComponentKey`, `AssetHealth`, `RepairRow`, `Mttr`, `MtbfInput`, `Mtbf`, `BacklogRow`, `BacklogBucket` | approvalRouting.ts:98, auth/tokens.ts:4, depreciation.ts:28, health.ts:31, healthService.ts:129, kpis.ts:15/20/79/88/146/151 | all in-file only | UNEXPORT (zero runtime effect, optional) |

The enum arrays in routes/*.ts cannot be shared with the frontend anyway, since apps/app does not import from apps/api. If shared enums are wanted, they belong in packages/ (like @assetcore/rbac). Until then, unexporting them is the honest state.

### DC-API-18. Dependencies pino-pretty and pino-roll: knip false positive. KEEP.
- apps/api/src/logger.ts:6 `target: 'pino-roll'` (always on, daily rotating file in LOGS_DIR) and logger.ts:13 `target: 'pino-pretty'` (when `isDev`, i.e. NODE_ENV is not production, which includes test). pino loads transports by string name in a worker thread, which knip cannot see.
- Action: add both to knip's `ignoreDependencies` for apps/api. Keep pino-pretty in `dependencies`, not devDependencies: `isDev` is true for any NODE_ENV other than production, so a container started without NODE_ENV=production would crash on a missing module. Confidence: high.

### Environment variables
- All 16 keys in apps/api/src/config.ts are read via `config.<KEY>` at least once (`grep -rn "config\.<KEY>\b" apps/api/src`). Outside config.ts, `process.env` is read only by auth/routes.ts:30 (`NODE_ENV === 'test'`, raising rate limits in tests).
- No env var is defined in an example file without a reader. apps/api/.env.example lacks `SMTP_SECURE` (present in deploy/.env.deploy.example and compose). That is a doc gap, not dead code. deploy/.env.deploy.example's `HTTP_PORT` and `VITE_*` are read by compose and the package script, not the API, which is correct.
- No feature flags exist in the API.

### Other in-handler checks
- TODO, FIXME, XXX, HACK: **zero** in apps/api/src, apps/api/test, scripts and db/migrations.
- console.*: two, both deliberate. config.ts:32 (fatal config error before the logger exists) and auth/mailer.ts:27 (prints the email body when SMTP is unset; also logs a warning through pino). KEEP.
- Commented-out code: none. The grep for comment lines starting with code tokens (`// const`, `// await`, `// return`, etc.) found only prose.
- Zod: a script checked all 317 top-level keys across every `z.object({...})` in routes/** and auth/**. Every key is referenced elsewhere in its file (as a column, an ALLOWED entry, or a destructure). No unused schema field was found. This is a weak check, because `buildSet(parsed.data, ALLOWED)` passes fields generically.
- Unreachable code: the duplicate route (DC-API-01) and the never-passed `orgId` branch (DC-API-09) are the only cases found.
- Observation (not dead code; for 05d): every router does `router.use(requireAuth, requireOrg, requireActiveMembership)` with no path and is mounted at the root of `/api`. Any request that matches no route therefore gets 401 from the first such router instead of the 404 handler in app.ts:37, and `filesRouter` (mounted after apiRouter) runs behind all of those middlewares. It works, but the 404 handler is effectively unreachable for unauthenticated callers. Side effect worth checking in 05d: profileRouter (profile.ts:9) asks only for `requireAuth`, but it is mounted after sitesRouter, so GET/PATCH /api/profile in practice also require an org and an active membership. Its narrower `use()` is dead in effect.

## Pass 6: scripts, Supabase leftovers, repo bloat

### scripts/*.mjs: all five are referenced. KEEP.

| Script | npm script (root package.json) | Other references |
|---|---|---|
| migrate.mjs | `migrate` | apps/api/Dockerfile, docs/DEPLOYMENT.md, docs/UPGRADE.md, README.md |
| package.mjs | `package` | deploy/nginx/Dockerfile, deploy/.env.deploy.example |
| provision.mjs | `provision` | docs/DEPLOYMENT.md |
| seed-dev.mjs | `seed:dev` | README.md. Still calls the legacy `recompute_asset_health()` at :266 (DC-API-12). |
| support-bundle.mjs | `support-bundle` | docs/OPERATIONS.md. It is the external consumer of /api/health and /api/version. |

### DC-API-19. Supabase-era leftovers: comments only, no live code.
- Grep: `grep -rniE "supabase|gotrue|postgrest|auth\.users|anon[ _-]?key|service_role|edge function|auth\.uid\(\)|auth\.jwt\(\)" apps/api db scripts deploy` (excluding node_modules, tmp, dist).
- No code path, SQL policy, role or env var depends on Supabase. The hits are all historical comments:
  - apps/api/.env.example:10 and apps/api/src/db.ts:18 ("the old service_role covered"). Reword to describe the owner pool on its own terms. 1 line each.
  - apps/api/src/routes/admin/billing.ts:50 ("same as the old Edge Function"). Drop the clause.
  - db/migrations/0001_baseline.sql:3-10, :85-86, :302, :1019, which describe the port. KEEP: migrations are history and must not be edited.
  - scripts/seed-dev.mjs:8 ("ported from the pre-pivot Supabase-era seed.sql ... supabase/ removed in Phase 8"). Harmless; optional trim.
- Classification: cosmetic DELETE of 3 comment fragments. Confidence: high.

### DC-API-20. Empty `supabase/` directory at the repo root.
- `supabase/functions/` and `supabase/snippets/` exist on disk with no files (created 2026-09-17, after commit 35c713a deleted supabase/ in Phase 8). `git ls-files supabase` is empty, and git does not track empty directories, so they do not appear in `git status`.
- Likely recreated by a local tool (the Supabase CLI or an editor extension). Classification: DELETE locally (`rmdir supabase/functions supabase/snippets supabase`). There is nothing to commit. Confidence: high.

### DC-API-21. Repo bloat: tracked vs ignored.
Method: `git ls-files -z | xargs -0 du -k | sort -rn` (290 tracked files), plus `git status --short --ignored`.
- **Tracked but not product code:**
  - `uat/` (936 KB on disk, 6 files): uat/uat.html (508 KB), uat/walkthrough/walkthrough.html (184 KB), round-1/2/3.json, walkthrough/2026-09-12.json. These are the UAT artifacts.
  - `audit/` (328 KB): AUDIT-REPORT.md, IMPLEMENTATION-PLAN.md, MOBILE-AUDIT.md and MOBILE-PLAN.md are tracked; this cleanup folder is untracked.
  - `docs/uat/` (56 KB): round-1/2/3 results markdown.
  - OWNER DECISION: these are working records, not cruft. If the repo is ever shipped to a client or open-sourced, move them out (another repo or a release-excluded folder). scripts/package.mjs builds from dist, so they do not reach the client tarball (worth confirming in 05d).
- **Ignored, correctly:** apps/api/data/ (23 MB of dev uploads and logs), apps/api/test/tmp/ (7.4 MB of test files and logs, including pino-roll output), apps/*/dist (about 3.2 MB), node_modules, .env files, deploy/instance.config.json, .DS_Store. None of these are tracked.
- No stray binaries are tracked: the only images are the three PWA icons in apps/app/public. No .log, .zip, .tar, .xlsx or .csv files are tracked.
- Largest tracked source files are expected (package-lock.json 236 KB, Assets.jsx 108 KB, 0001_baseline.sql 52 KB).

### Aside (not dead code, for 05d)
- GET /api/version (routes/health.ts:21-32) and GET /api/admin/version (routes/admin/version.ts:15-) are the same handler written twice, each re-reading package.json. It could be one function.
- Both report `apps/api/package.json` version **1.0.0**, while the root package.json is **1.1.0** and CHANGELOG.md is ahead. The version a support bundle reports may be stale.

## Summary

| ID | File | Symbol / route | Action | Est. lines removable |
|---|---|---|---|---|
| DC-API-01 | apps/api/src/routes/compliance.ts:207 | duplicate DELETE /api/compliance-audits/:id (second copy at :492 unreachable) | delete first copy (lines 207-216) | 10 |
| DC-API-02 | apps/api/src/routes/reports.ts, reportBuilders.ts:5-139, files.ts:138 | /api/reports (4 endpoints, test-only) | owner decision | ~310 src + ~70 test |
| DC-API-03 | apps/api/src/routes/spareParts.ts | 11 spare-parts endpoints (UI parked as "coming soon") | owner decision | ~275 |
| DC-API-04 | apps/api/src/routes/documents.ts | /api/documents (4 endpoints, panel never mounted, files undownloadable) | owner decision | 159 |
| DC-API-05 | apps/api/src/routes/admin/orgs.ts:36-81 | POST /admin/orgs, /suspend, /restore | keep (document it) or delete | 29 |
| DC-API-06 | apps/api/src/routes/admin/users.ts:63-101 | POST /admin/users/:id/invite | delete | 39 |
| DC-API-07 | various (see table) | 6 delete candidates: compliance-licences/counts, compliance-audits/stats, GET inspections/:id, GET integrations/:kind, GET work-orders/:id/tasks, GET work-orders/:id/parts | delete | 86 |
| DC-API-07 | various (see table) | 7 unwired: devices readings, inspection-template CRUD, maintenance-completions GET and report POST, PATCH pm-schedules, DELETE work-orders, PATCH WO part | owner decision | ~186 |
| DC-API-07 | apps/api/src/routes/assets.ts:199 | GET /api/assets/:id | keep (tests) | 0 |
| DC-API-08 | apps/api/src/routes/health.ts | /api/health, /api/version | keep (ops consumers) | 0 |
| DC-API-09 | apps/api/src/health.ts, healthService.ts, routes/health.ts | three "health" modules | keep; optional rename; drop unused `orgId` branch | 4 |
| DC-API-10 | apps/api/test/health.test.ts:43-58 | "decay math" test of legacy SQL | delete | 16 |
| DC-API-11 | db/migrations/0001_baseline.sql:519 | SQL `licence_status(date)` | delete via new migration | 0 (adds ~1) |
| DC-API-12 | db/migrations 0016/0027, scripts/seed-dev.mjs:266 | SQL `recompute_asset_health`, `recompute_asset_health_for` | owner decision, then drop via migration | 1 (+ migration) |
| DC-API-13 | db/migrations/0001_baseline.sql:727 | table `sms_log` | owner decision (check rows) | 0 (migration) |
| DC-API-14 | apps/api/src/routes/devices.ts:113 | table `telemetry_readings` (never written) | keep (IoT roadmap) | 0 |
| DC-API-15 | db/migrations/0021:123 | column `documents.mime_type` | delete via migration with DC-API-04 | 0 (migration) |
| DC-API-16 | db/migrations/0021:77, 0022:389-398 | columns `pm_schedules.interval_days`, `checklist_template`, `asset_categories.salvage_rate_pct` (read, never settable) | owner decision (wire up or drop) | 0 |
| DC-API-17 | apps/api/src (see table) | `mailerConfigured` | delete | 4 |
| DC-API-17 | apps/api/src (see table) | `ROLE_CAPABILITIES` re-export | delete from re-export | 0 (1 token) |
| DC-API-17 | apps/api/src (see table) | 35 symbols used only in their own file (24 values: enum arrays and helpers; 11 types) | unexport | 0 |
| DC-API-18 | apps/api/package.json | pino-pretty, pino-roll | keep (knip ignore) | 0 |
| DC-API-19 | db.ts:18, .env.example:10, admin/billing.ts:50 | Supabase-era comments | delete comment fragments | ~3 |
| DC-API-20 | supabase/ (untracked, empty) | empty directories | delete locally | 0 |
| DC-API-21 | uat/, audit/, docs/uat/ | tracked working records (~1.3 MB) | owner decision | 0 code |

**Totals (API source and tests, migrations excluded):**
- Safe now (delete without an owner decision: 01, 06, 07 delete-candidates, 09 branch, 10, 17 `mailerConfigured`, 19): **about 162 lines**.
- Owner decisions (02, 03, 04, 05, 07 unwired, 12): **about 1,030 lines** more if every one is resolved as delete, plus the matching frontend files counted in 05a.
- Forward migrations suggested: drop `licence_status`; after owner sign-off, drop `recompute_asset_health(_for)`, `sms_log`, `documents.mime_type`.
- Endpoint count: 238 total. 198 live, 29 whose only caller is an unused helper or an unreachable file, 4 test-only, 7 with no caller at all (2 of which, /api/health and /api/version, have documented external consumers).

Status: complete.
