import { test, expect } from './fixtures.js'
import { seed } from './fixtures.js'

test('the Log tab can show the browser UI diagnostics log', async ({ wede }) => {
  const { page } = wede
  await page.addInitScript(() => {
    localStorage.setItem('wede_visible', JSON.stringify({ log: true }))
  })
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()

  await page.getByLabel('Select Log 1').click()
  await page.getByTestId('log-mode-ui').click()

  await expect(page.getByText('ui.log', { exact: true })).toBeVisible()
  await expect(page.getByText(/browser diagnostics installed/)).toBeVisible()

  const lines = await page.evaluate(() => window.wedeLog)
  expect(Array.isArray(lines)).toBe(true)
  expect(lines?.some((line) => line.includes('browser diagnostics installed'))).toBe(true)
})
