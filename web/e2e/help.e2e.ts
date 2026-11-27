import { test, expect, seed, installBackend, watchForCrashes } from './fixtures'

test('help renders the shared heading and list formatting', async ({ page }) => {
  const crashes = watchForCrashes(page)
  await installBackend(page)
  await seed(page, 'authed')
  await page.goto('/')

  await page.getByRole('menuitemcheckbox', { name: 'Help' }).click()
  await page.getByLabel('Select Help').click()

  await expect(page.getByText('HOW TO USE WEB-DEVELOPMENT IDE')).toBeVisible()
  await expect(page.getByText(/Tab types/)).toBeVisible()
  await expect(page.getByText('Quick open')).toBeVisible()
  await expect(page.getByText('Swipe a tab to the bottom-right to close it (locked tabs stay)')).toBeVisible()

  expect(crashes.pageErrors).toEqual([])
})
