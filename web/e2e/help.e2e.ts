import { test, expect, seed, installBackend, watchForCrashes } from './fixtures'

test('help renders the shared heading and list formatting', async ({ page }) => {
  const crashes = watchForCrashes(page)
  await installBackend(page)
  await seed(page, 'authed')
  await page.goto('/')

  await page.getByRole('menuitemcheckbox', { name: 'Help' }).click()
  await page.getByLabel('Select Help').click()

  await expect(page.getByRole('heading', { name: /How to use/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tab types' })).toBeVisible()
  await expect(page.getByText('Quick open')).toBeVisible()
  await expect(page.getByText('Swipe a tab up-right to close it')).toBeVisible()

  expect(crashes.pageErrors).toEqual([])
})
