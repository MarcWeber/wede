import { test, expect, seed } from './fixtures.js'
import type { Page } from '@playwright/test'

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

function point(x: number, y: number) {
  return [{ x, y }]
}

async function swipeUpRight(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x + 64, y - 40) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test('swiping a tab up-right closes it', async ({ wede }) => {
  const { page } = wede
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('main.go', { exact: true }).click()

  const matches = page.getByLabel('Select main.go')
  await expect(matches).toHaveCount(2)
  const tab = matches.first()
  const box = await tab.boundingBox()
  expect(box).not.toBeNull()

  await swipeUpRight(page, box!.x + box!.width / 2, box!.y + box!.height / 2)
  await expect(matches).toHaveCount(1)
})
