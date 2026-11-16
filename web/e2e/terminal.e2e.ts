/**
 * terminal.e2e.ts — the [=] button on touch/small screens.
 *
 * Regression guards:
 *   - Tapping the collapsed [=] used to switch `input_send` on (a full input
 *     row appeared) instead of opening the menu. The menu is where that toggle
 *     belongs.
 *   - The menu must stay inside a short landscape viewport (it used to be
 *     anchored with top-full/bottom-full and run off the bottom of the screen,
 *     which looked like a blank/broken view).
 */

import { test, expect } from './fixtures.js'
import { seed } from './fixtures.js'
import type { Page } from '@playwright/test'

async function openTerminal(page: Page) {
  await page.keyboard.press('Control+Shift+P')
  const palette = page.getByPlaceholder('Type a command…')
  await palette.waitFor()
  await palette.fill('Toggle Terminal')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('terminal-menu-btn')).toBeVisible()
}

test('collapsed [=] opens the menu without enabling input_send', async ({ wede }) => {
  const { page } = wede
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  await openTerminal(page)

  // Collapsed: only the = button, no input row.
  await expect(page.getByPlaceholder('Type command...')).toHaveCount(0)
  await expect(page.getByTestId('terminal-menu')).toHaveCount(0)

  await page.getByTestId('terminal-menu-btn').click()
  await expect(page.getByTestId('terminal-menu')).toBeVisible()

  // The bug: this click used to set input_send = true.
  await expect(page.getByPlaceholder('Type command...')).toHaveCount(0)
  const dock = await page.evaluate(() => localStorage.getItem('wede_terminal_input_dock'))
  const parsed = dock ? (JSON.parse(dock) as { inputSend?: boolean }) : null
  expect(parsed?.inputSend ?? false).toBe(false)
})

test('enabling input_send from the menu shows the input row', async ({ wede }) => {
  const { page } = wede
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  await openTerminal(page)

  await page.getByTestId('terminal-menu-btn').click()
  const menu = page.getByTestId('terminal-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('input_send').click()

  await expect(page.getByPlaceholder('Type command...')).toBeVisible()
  const dock = await page.evaluate(() => localStorage.getItem('wede_terminal_input_dock'))
  expect((JSON.parse(dock || '{}') as { inputSend?: boolean }).inputSend).toBe(true)
})

test('min cols keeps the grid wide and scrolls horizontally instead of wrapping', async ({ wede }) => {
  const { page } = wede
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem(
      'wede_terminal_settings',
      JSON.stringify({ fontSize: 13, minCols: 80, minRows: 0, scrollback: 5000 }),
    )
  })
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  await openTerminal(page)

  const scroll = page.getByTestId('terminal-scroll').first()
  await expect(scroll).toBeVisible()
  await expect(page.locator('.xterm').first()).toBeVisible()

  // The grid is wider than the phone: the container must overflow (scroll)
  // rather than squeezing xterm down to fit.
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(50)
  const xtermWidth = await page.locator('.xterm').first().evaluate((el) => el.getBoundingClientRect().width)
  const clientWidth = await scroll.evaluate((el) => el.clientWidth)
  expect(xtermWidth).toBeGreaterThan(clientWidth)
})

test('the [=] menu fits inside a short landscape viewport', async ({ wede }) => {
  const { page } = wede
  await page.setViewportSize({ width: 750, height: 342 })
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  await openTerminal(page)

  await page.getByTestId('terminal-menu-btn').click()
  const menu = page.getByTestId('terminal-menu')
  await expect(menu).toBeVisible()

  const box = await menu.boundingBox()
  expect(box, 'menu has no layout box').not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(342 + 1)
})
