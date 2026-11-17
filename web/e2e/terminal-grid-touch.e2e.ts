/**
 * terminal-grid-touch.e2e.ts — touch gestures for the configurable terminal
 * grid. Mouse/keyboard tests live in terminal.e2e.ts.
 */

import { test, expect } from './fixtures.js'
import { seed } from './fixtures.js'
import type { Page } from '@playwright/test'

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

async function openTerminal(page: Page) {
  await page.keyboard.press('Control+Shift+P')
  const palette = page.getByPlaceholder('Type a command…')
  await palette.waitFor()
  await palette.fill('Toggle Terminal')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('terminal-grid')).toBeVisible()
}

async function boot(page: Page) {
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
  await openTerminal(page)
}

function point(x: number, y: number) {
  return [{ x, y }]
}

function fileBuffer(text: string) {
  return (globalThis as unknown as { Buffer: { from(input: string): unknown } }).Buffer.from(text) as never
}

test.describe('terminal grid touch gestures', () => {
  test('tap opens the settings menu', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    await page.getByTestId('terminal-cell-B2').tap()
    await expect(page.getByTestId('terminal-menu')).toBeVisible()
  })

  test('a swipe runs an action without opening the menu', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    const cell = page.getByTestId('terminal-cell-B2')
    const box = await cell.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(cx, cy) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(cx + 50, cy) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page.getByTestId('terminal-menu')).toHaveCount(0)
  })

  test('long-press opens the radial and release does not run the centre', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    const cell = page.getByTestId('terminal-cell-B2')
    const box = await cell.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(cx, cy) })
    const radial = page.getByTestId('terminal-radial')
    await expect(radial).toBeVisible({ timeout: 2000 })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page.getByTestId('terminal-menu')).toHaveCount(0)
    await expect(radial).toBeVisible()
    await page.touchscreen.tap(10, 400)
    await expect(radial).toHaveCount(0)
  })

  test('long-click with a mouse opens the radial on Fx', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    const box = await page.getByTestId('terminal-cell-A2').boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    const radial = page.getByTestId('terminal-radial')
    await expect(radial).toBeVisible({ timeout: 2000 })
    await page.mouse.up()
    await expect(radial).toBeVisible()
    await page.mouse.click(10, 400)
    await expect(radial).toHaveCount(0)
  })

  test('grid cells disable long-press text selection', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    const userSelect = await page.getByTestId('terminal-cell-A2')
      .evaluate((el) => getComputedStyle(el).userSelect)
    expect(userSelect).toBe('none')
  })

  test('JSON menu config can be pasted and applied', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    await page.getByTestId('terminal-cell-B2').tap()
    const menu = page.getByTestId('terminal-menu')
    await menu.getByText('menu config (JSON)').tap()
    await page.getByTestId('terminal-json').fill(JSON.stringify({
      B2: { T: 'open-settings', l: 'send-ctrl-c' },
    }, null, 2))
    await page.getByTestId('terminal-json-apply').tap()
    await expect(menu.getByText('applied')).toBeVisible()
    await page.touchscreen.tap(10, 400)
    await expect(page.getByTestId('terminal-cell-B2')).toBeVisible()
    await expect(page.getByTestId('terminal-cell-A2')).toHaveCount(0)
  })

  test('JSON menu config can be downloaded and loaded from a file', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    await page.getByTestId('terminal-cell-B2').tap()
    const menu = page.getByTestId('terminal-menu')
    await menu.getByText('menu config (JSON)').tap()
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('terminal-json-download').tap()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('wede-terminal-grid.json')

    await page.getByTestId('terminal-json-file').setInputFiles({
      name: 'grid.json',
      mimeType: 'application/json',
      buffer: fileBuffer(JSON.stringify({ C3: { T: 'open-settings', r: 'send-key-tab' } })),
    })
    await expect(menu.getByText('applied')).toBeVisible()
    await page.touchscreen.tap(10, 400)
    await expect(page.getByTestId('terminal-cell-C3')).toBeVisible()
    await expect(page.getByTestId('terminal-cell-A2')).toHaveCount(0)
  })

  test('custom text actions can be assigned and cleared', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    await page.getByTestId('terminal-cell-B2').tap()
    const menu = page.getByTestId('terminal-menu')
    await menu.getByText('configure behavior').tap()
    await page.getByTestId('configure-cell-A1').tap()
    await page.getByTestId('slot-T').tap()
    await menu.locator('button').filter({ hasText: 'send any literal text' }).tap()
    await page.getByTestId('custom-text').fill('ZQ')
    await page.getByTestId('custom-text-apply').tap()
    await expect(page.getByTestId('slot-T')).toContainText('ZQ')

    await page.getByTestId('cell-clear-all').tap()
    await expect(page.getByTestId('slot-T')).toContainText('—')
  })

  test('clear all cannot remove the last settings action', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    await page.getByTestId('terminal-cell-B2').tap()
    const menu = page.getByTestId('terminal-menu')
    await menu.getByText('configure behavior').tap()
    await page.getByTestId('configure-cell-B2').tap()
    await page.getByTestId('cell-clear-all').tap()
    await expect(menu.getByText('assign a second button to the settings')).toBeVisible()
  })

  test('the last settings action cannot be cleared', async ({ wede }) => {
    const { page } = wede
    await boot(page)
    await page.getByTestId('terminal-cell-B2').tap()
    const menu = page.getByTestId('terminal-menu')
    await menu.getByText('configure behavior').tap()
    await menu.getByText('B2', { exact: true }).tap()
    await page.getByTestId('slot-T').tap()
    await page.getByTestId('action-clear').tap()
    await expect(menu.getByText('assign a second button to the settings')).toBeVisible()
  })
})
