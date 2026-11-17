import { test, expect, seed } from './fixtures'

test('ui scale applies per-orientation and fits the viewport', async ({ wede }) => {
  const { page } = wede
  await seed(page, 'authed')
  await page.addInitScript(() => {
    localStorage.setItem('wede_ui_scale', JSON.stringify({
      portrait: { x: 0.8, y: 0.7 },
      landscape: { x: 0.9, y: 0.85 },
    }))
  })
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  const root = page.getByTestId('app-root')
  await expect(root).toHaveCSS('transform', 'matrix(0.9, 0, 0, 0.85, 0, 0)')
  const box = await root.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.width).toBeCloseTo(viewport!.width, 0)
  expect(box!.height).toBeCloseTo(viewport!.height, 0)
  await expect(page.getByText('README.md')).toBeVisible()
})
