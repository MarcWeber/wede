import { test, expect, seed } from './fixtures.js'
import type { Page } from '@playwright/test'

async function boot(page: Page) {
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('main.go', { exact: true }).click()
}

test('mouse drag down-right shows the close label and closes the tab', async ({ wede }) => {
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
  // Stay inside the 5*D button cap so release fires Close instead of a drag.
  await page.mouse.move(x + 28, y + 28, { steps: 8 })

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

test('shift-click selects from the last clicked tab and keeps the anchor', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  for (const name of ['README.md', 'long.txt']) {
    await page.getByLabel('Select Files').first().click()
    await page.getByText(name, { exact: true }).click()
  }

  const first = page.getByLabel('Select main.go').first()
  const middle = page.getByLabel('Select README.md').first()
  const last = page.getByLabel('Select long.txt').first()
  const beforeRange = page.getByLabel('Select Files').first()

  await expect(first).toBeVisible()
  await expect(middle).toBeVisible()
  await expect(last).toBeVisible()
  await first.click()
  await last.click({ modifiers: ['Shift'] })

  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(middle).toHaveAttribute('aria-selected', 'true')
  await expect(last).toHaveAttribute('aria-selected', 'true')
  await expect(beforeRange).toHaveAttribute('aria-selected', 'false')

  // A second shift-click must still extend from the first tab (the anchor),
  // not from the tab that was shift-clicked last.
  await middle.click({ modifiers: ['Shift'] })
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(middle).toHaveAttribute('aria-selected', 'true')
  await expect(last).toHaveAttribute('aria-selected', 'false')
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


test('tab drag enters drop mode only past the threshold and docks in a corner', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  const tab = page.locator('[data-reorder-id]').first()
  const box = await tab.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()

  // Inside the 5*D button cap and below 60px: still just a hint, not a tab drag.
  await page.mouse.move(x + 25, y + 25, { steps: 5 })
  await expect(page.locator('[data-drop-corner="left"]')).toHaveCount(0)
  await expect(page.getByTestId('drag-hint-dot')).toBeVisible()

  // Past 60px the tab detaches and the literal corner drop zones appear.
  await page.mouse.move(x + 90, y + 90, { steps: 5 })
  const left = page.locator('[data-drop-corner="left"]')
  await expect(left).toBeVisible()
  await expect(page.locator('[data-drop-corner="right"]')).toBeVisible()

  const target = await left.boundingBox()
  expect(target).not.toBeNull()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 5 })
  await page.mouse.up()

  await expect(page.locator('[data-dock-side="left"]')).toBeVisible()
  await expect(page.getByLabel('Select main.go').first()).toBeVisible()
})

test('tab dragged into the empty centre floats at the release point', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  const tab = page.locator('[data-reorder-id]').first()
  const box = await tab.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  const releaseX = x + 260
  const releaseY = y + 190

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(releaseX, releaseY, { steps: 12 })
  await page.mouse.up()

  const float = page.locator('[data-float]').first()
  await expect(float).toBeVisible()
  const floatBox = await float.boundingBox()
  expect(floatBox).not.toBeNull()
  expect(Math.abs(floatBox!.x + floatBox!.width / 2 - releaseX)).toBeLessThan(80)
  expect(Math.abs(floatBox!.y - releaseY)).toBeLessThan(80)
})

test('dragging straight down past the hint region floats instead of opening the tab menu', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  const tab = page.locator('[data-reorder-id]').first()
  const box = await tab.boundingBox()
  expect(box).not.toBeNull()
  // Start near the tab's right edge so the release lands in the empty centre,
  // not on the left dock strip that appears as soon as drop mode starts.
  const x = box!.x + box!.width - 8
  const y = box!.y + box!.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 180, { steps: 12 })
  await page.mouse.up()

  await expect(page.locator('[data-float]').first()).toBeVisible()
  await expect(page.getByText('Tab menu')).toHaveCount(0)
})

test('tab drag ending with a horizontal move still drops and clears drop mode', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  const tab = page.locator('[data-reorder-id]').first()
  const box = await tab.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()

  // Start a tab drag (past the 5*D button cap and the tab-drag threshold).
  await page.mouse.move(x, y + 130, { steps: 10 })
  await expect(page.locator('[data-drop-corner="left"]')).toBeVisible()

  // End with a horizontal move over another tab. This used to match the
  // mouse-scroll predicate on release, swallowing the drop and leaving the
  // drop zones stuck on screen.
  await page.mouse.move(x + 100, y + 10, { steps: 6 })
  await page.mouse.up()

  await expect(page.locator('[data-drop-corner]')).toHaveCount(0)
  await expect(page.locator('[data-drop-mode="docked-left"]')).toHaveCount(0)
  await expect(page.locator('[data-drop-mode="docked-right"]')).toHaveCount(0)
  await expect(page.locator('[data-drop-mode="docked-bottom"]')).toHaveCount(0)
  await expect(page.getByTestId('drag-hint-dot')).toHaveCount(0)
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
  const px = x + 28
  const py = y + 28

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

  // The "Close tab" label should be active (the drag direction is down-right).
  await expect(page.getByText('Close tab')).toBeVisible()

  await page.mouse.up()
})
