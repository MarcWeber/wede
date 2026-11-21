import { test, expect, seed } from './fixtures.js'
import type { Page } from '@playwright/test'

async function boot(page: Page) {
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('main.go', { exact: true }).click()
}

test('mouse drag up-right shows the close label and closes the tab', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  const tabs = page.getByLabel('Select main.go')
  await expect(tabs).toHaveCount(2)
  const tab = tabs.first()
  const box = await tab.boundingBox()
  expect(box).not.toBeNull()

  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 70, y - 50, { steps: 8 })

  await expect(page.getByText('Close tab')).toBeVisible()
  await expect(page.getByTestId('drag-hint-dot')).toBeVisible()
  await page.mouse.up()
  await expect(tabs).toHaveCount(1)
})

test('mouse drag left/right scrolls an overflowing tab strip', async ({ wede }) => {
  const { page } = wede
  await page.setViewportSize({ width: 600, height: 500 })
  await boot(page)
  for (const name of ['README.md', 'long.txt', 'doc.pdf', 'pic.png']) {
    await page.getByLabel('Select Files').first().click()
    await page.getByText(name, { exact: true }).click()
  }
  await page.getByLabel('Select Files').first().click()
  await page.getByText('src', { exact: true }).click()
  await page.getByText('app.js', { exact: true }).click()

  const tab = page.locator('[data-reorder-id]:visible').filter({ hasText: 'main.go' }).first()
  const strip = tab.locator('xpath=..')
  const { before, max } = await strip.evaluate((el) => ({
    before: el.scrollLeft,
    max: el.scrollWidth - el.clientWidth,
  }))
  expect(max).toBeGreaterThan(0)
  const box = await tab.boundingBox()
  expect(box).not.toBeNull()

  const dx = before >= max ? 120 : before <= 0 ? -120 : before > max / 2 ? -120 : 120
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2, { steps: 10 })
  await page.mouse.up()

  const after = await strip.evaluate((el) => el.scrollLeft)
  expect(after).not.toBe(before)
})

test('left swipe on Files lists tabs other people have open', async ({ page }) => {
  const { installBackend, watchForCrashes } = await import('./fixtures.js')
  const crashes = watchForCrashes(page)
  await installBackend(page, {
    collab: (ws) => {
      ws.send(JSON.stringify({ type: 'self', id: 'm1' }))
      ws.send(JSON.stringify({
        type: 'presence',
        members: [{ id: 'm2', username: 'alice', color: '#f87171', tabs: ['main.go', 'src/app.js'] }],
      }))
    },
  })
  await seed(page, 'authed')
  await page.goto('/')

  const row = page.getByRole('menuitemcheckbox', { name: 'Files' })
  const box = await row.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width - 12, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + 12, box!.y + box!.height / 2, { steps: 8 })
  await page.mouse.up()

  await expect(page.getByText('Open tabs')).toBeVisible()
  await expect(page.getByRole('button', { name: /main\.go/ })).toBeVisible()
  await page.getByRole('button', { name: /main\.go/ }).click()
  await expect(page.getByText('package main')).toBeVisible()

  expect(crashes.pageErrors).toEqual([])
})


test('gesture dot is relocated away from the pointer under UI scale', async ({ wede }) => {
  const { page } = wede
  await page.addInitScript(() => {
    localStorage.setItem('wede_ui_scale', JSON.stringify({
      portrait: { x: 0.5, y: 0.5 },
      landscape: { x: 0.5, y: 0.5 },
    }))
    localStorage.setItem('wede_ui_scale_enabled', '1')
  })
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('main.go', { exact: true }).click()

  // Use the data-reorder-id selector to target the actual tab in the strip,
  // not the editor element that also carries the same aria-label.
  const tab = page.locator('[data-reorder-id]').first()
  const box = await tab.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  const px = x + 70
  const py = y - 50

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(px, py, { steps: 8 })

  const dot = page.getByTestId('drag-hint-dot')
  await expect(dot).toBeVisible()
  const dotBox = await dot.boundingBox()
  expect(dotBox).not.toBeNull()

  // The dot should be relocated away from the drag endpoint so the user can
  // see the action labels. Under UI scale the overlay is portaled to <body>
  // (viewport coords) so the dot stays on screen.
  const dotX = dotBox!.x + dotBox!.width / 2
  const dotY = dotBox!.y + dotBox!.height / 2
  expect(Math.hypot(dotX - px, dotY - py)).toBeGreaterThan(20)

  // The "Close tab" label should be active (the drag direction is up-right).
  await expect(page.getByText('Close tab')).toBeVisible()

  await page.mouse.up()
})
