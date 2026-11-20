import { test, expect, seed } from './fixtures.js'

test('PDF renders in the embedded pdf.js viewer by default', async ({ wede }) => {
  await seed(wede.page, 'authed')
  await wede.page.goto('/')

  await wede.page.getByText('doc.pdf', { exact: true }).click()

  await expect(wede.page.locator('canvas[aria-label="PDF page 1"]')).toBeVisible()
})

test('PDF tab-choose mode offers open-here and external-tab choices', async ({ wede }) => {
  await seed(wede.page, 'authed')
  // Per-browser override: ask instead of auto-embedding.
  await wede.page.addInitScript(() => {
    localStorage.setItem('wede_media_view', JSON.stringify({ pdf: 'tab-choose' }))
  })
  await wede.page.goto('/')

  await wede.page.getByText('doc.pdf', { exact: true }).click()

  await expect(wede.page.getByRole('button', { name: 'Open here' })).toBeVisible()
  await expect(wede.page.getByRole('link', { name: 'Open in external tab' })).toBeVisible()

  const headerLink = wede.page.getByTitle('Open in external tab').last()
  await expect(headerLink).toBeVisible()
  await expect(headerLink).toHaveAttribute('href', /\/files\/raw\?path=doc\.pdf&inline=1/)
})
