import pw from '/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js'
const { chromium } = pw
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.removeItem('ui_prefs'))
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200)
await page.click('a[href="/identities"]'); await page.waitForTimeout(1300)
await page.screenshot({ path: '/app/_s/identities.png' })
await browser.close(); console.log('done')
