/**
 * terminal.e2e.ts — the floating action grid on touch/small screens.
 *
 * Regression guards:
 *   - The grid is the toolbar: tapping the default "=" cell (B2) opens the
 *     settings menu; there is no separate input row.
 *   - The menu must stay inside a short landscape viewport (it used to be
 *     anchored with top-full/bottom-full and run off the bottom of the screen).
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
  await expect(page.getByTestId('terminal-grid')).toBeVisible()
}

test('tapping the = cell opens the settings menu', async ({ wede }) => {
  const { page } = wede
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  await openTerminal(page)

  await expect(page.getByTestId('terminal-menu')).toHaveCount(0)
  await page.getByTestId('terminal-cell-B2').click()
  await expect(page.getByTestId('terminal-menu')).toBeVisible()
  await expect(page.getByTestId('terminal-menu').getByText('configure behavior')).toBeVisible()
})

test('configure behavior lists the grid buttons', async ({ wede }) => {
  const { page } = wede
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  await openTerminal(page)

  await page.getByTestId('terminal-cell-B2').click()
  const menu = page.getByTestId('terminal-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('configure behavior').click()
  await expect(menu.getByText('select a button')).toBeVisible()
  await expect(menu.getByText('B2', { exact: true })).toBeVisible()
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

test('the settings menu fits inside a short landscape viewport', async ({ wede }) => {
  const { page } = wede
  await page.setViewportSize({ width: 750, height: 342 })
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  await openTerminal(page)

  await page.getByTestId('terminal-cell-B2').click()
  const menu = page.getByTestId('terminal-menu')
  await expect(menu).toBeVisible()

  const box = await menu.boundingBox()
  expect(box, 'menu has no layout box').not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(342 + 1)
})
