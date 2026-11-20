import { test, expect, seed } from './fixtures.js'

test('image opens full-tab and zooms with the toolbar', async ({ wede }) => {
  await seed(wede.page, 'authed')
  await wede.page.goto('/')

  await wede.page.getByText('pic.png', { exact: true }).click()
  await expect(wede.page.getByAltText('pic.png')).toBeVisible()
  await expect(wede.page.getByText('100%')).toBeVisible()

  await wede.page.getByTitle('Zoom in').click()
  await expect(wede.page.getByText('125%')).toBeVisible()

  await wede.page.getByTitle('Fit image').click()
  await expect(wede.page.getByText('100%')).toBeVisible()
  await expect(wede.page.getByTitle('Open in external tab')).toBeVisible()
})
