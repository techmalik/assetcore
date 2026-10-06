// Signs in as each role and opens every page, so a change that breaks a page
// for some role shows up before a user finds it. The large file splits in
// Wave 5 move thousands of lines of JSX; this is the check that the pages
// still render.
//
// A page fails when it shows the error boundary, throws, logs a console error,
// or gets a 5xx from the API. A 4xx is reported but does not fail: some roles
// are meant to be refused some reads.
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { ROLE_KEYS } from '@assetcore/rbac'

const PASSWORD = 'Password123!'
const emailFor = (role) => (role === 'owner' ? 'a.okeke@ngml.example' : `${role}@ngml.example`)

// Every signed-in route, read from the route table (apps/app/src/routes.js)
// so a new page is covered without editing this test. A role that may not
// open a page is redirected to the dashboard, which is checked the same way.
const ROUTES = [...readFileSync(new URL('../apps/app/src/routes.js', import.meta.url), 'utf8')
  .matchAll(/path: '(\/[a-z-]+)'/g)].map((m) => m[1])

/** Collects what counts as a failure while the page is used. */
function watch(page) {
  const problems = []
  const refused = new Set()
  let inflight = 0
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`))
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    // The browser logs every failed request as a console error; responses are
    // judged below by status instead.
    if (msg.text().startsWith('Failed to load resource')) return
    problems.push(`console.error: ${msg.text().slice(0, 300)}`)
  })
  page.on('request', () => { inflight++ })
  page.on('requestfinished', () => { inflight-- })
  page.on('requestfailed', () => { inflight-- })
  page.on('response', (res) => {
    const path = new URL(res.url()).pathname
    if (!path.startsWith('/api/')) return
    if (res.status() >= 500) problems.push(`${res.status()} ${res.request().method()} ${path}`)
    else if (res.status() >= 400 && res.status() !== 401) refused.add(`${res.status()} ${path}`)
  })
  return {
    problems,
    refused,
    /** Waits until no request has been in flight for a moment. */
    async settle() {
      const deadline = Date.now() + 10_000
      let quietSince = Date.now()
      while (Date.now() < deadline) {
        if (inflight > 0) quietSince = Date.now()
        else if (Date.now() - quietSince > 300) return
        await page.waitForTimeout(50)
      }
    },
  }
}

async function signIn(page, role) {
  await page.goto('/auth')
  await page.locator('input[type=email]').fill(emailFor(role))
  await page.locator('input[autocomplete=current-password]').fill(PASSWORD)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15_000 })
}

/** Client-side navigation: the app stays loaded, as it does for a user. */
async function go(page, path) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

async function expectRendered(page, where) {
  await expect(page.getByText('Something went wrong'), `error boundary on ${where}`).toHaveCount(0)
}

/** Opens the first row's detail, then the page's main "new" form, then closes it. */
async function openDetailAndNew(page, w, where, newButton) {
  const row = page.locator('tbody tr').first()
  if (await row.count()) {
    await row.click()
    await w.settle()
    await expectRendered(page, `${where}, first row's detail`)
  }
  const button = page.getByRole('button', { name: newButton, exact: true })
  if (await button.count()) {
    await button.first().click()
    await w.settle()
    await expectRendered(page, `${where}, "${newButton}" form`)
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click({ timeout: 5_000 })
    await w.settle()
  }
}

for (const role of ROLE_KEYS) {
  test(`${role}: every page renders`, async ({ page }) => {
    expect(ROUTES.length, 'routes read from routes.js').toBeGreaterThan(15)
    const w = watch(page)
    await signIn(page, role)
    await w.settle()

    for (const path of ROUTES) {
      await go(page, path)
      await w.settle()
      await expectRendered(page, `${path} as ${role}`)

      if (path === '/admin' && new URL(page.url()).pathname === '/admin') {
        // Each Admin tab is its own screen.
        const tabs = page.locator('.tab-btn')
        for (let i = 0; i < await tabs.count(); i++) {
          await tabs.nth(i).click()
          await w.settle()
          await expectRendered(page, `admin tab ${i} as ${role}`)
        }
      }
      if (path === '/assets') await openDetailAndNew(page, w, `/assets as ${role}`, 'Add Asset')
      if (path === '/work-orders') await openDetailAndNew(page, w, `/work-orders as ${role}`, 'New WO')
      if (path === '/defects' && new URL(page.url()).pathname === '/defects') await openDetailAndNew(page, w, `/defects as ${role}`, 'Raise Defect')
    }

    if (w.refused.size) {
      test.info().annotations.push({ type: 'refused', description: [...w.refused].sort().join(', ') })
    }
    expect(w.problems, `problems as ${role}`).toEqual([])
  })
}
