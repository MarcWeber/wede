/**
 * ide-polish.e2e.ts — regressions for the recent IDE polish pass.
 *
 *   - Search keeps its query when the user switches to a file and back.
 *   - A right swipe on the Files menu row adds a second Files tab.
 *   - Settings exposes collaboration settings and API/Log/Chat are hidden by default.
 *   - Select all in the explorer includes directories, and Expand one level
 *     reveals their children.
 */

import { test, expect, seed } from './fixtures.js'
import type { Page } from '@playwright/test'

async function boot(page: Page) {
  await seed(page, 'authed')
  await page.goto('/')
  await expect(page.getByText('README.md')).toBeVisible()
}

test('search query survives switching to a file and back', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  await page.keyboard.press('Control+Shift+F')
  const input = page.getByPlaceholder('Search files… (Enter to run)')
  await expect(input).toBeVisible()
  await input.fill('needle')

  await page.getByLabel('Select Files').click()
  await page.getByText('README.md').click()
  await expect(input).toBeHidden()

  await page.keyboard.press('Control+Shift+F')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('needle')
})

test('swiping the Files menu row adds a second Files tab', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  const tabs = page.getByLabel('Select Files')
  await expect(tabs).toHaveCount(1)

  const row = page.getByRole('menuitemcheckbox', { name: 'Files' })
  const box = await row.boundingBox()
  expect(box).not.toBeNull()
  const y = box!.y + box!.height / 2
  await page.mouse.move(box!.x + 8, y)
  await page.mouse.down()
  await page.mouse.move(box!.x + 64, y, { steps: 6 })
  await page.mouse.up()

  await expect(tabs).toHaveCount(2)
})

test('Settings shows Collaboration and hides API/Log/Chat by default', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  await page.getByRole('menuitemcheckbox', { name: 'Settings' }).click()

  await expect(page.getByRole('button', { name: 'Open Folder' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open Workspace' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Collaboration' })).toBeVisible()

  for (const kind of ['api', 'log', 'chat']) {
    await expect(page.getByRole('checkbox', { name: kind, exact: true })).not.toBeChecked()
  }
  await expect(page.getByRole('checkbox', { name: 'files', exact: true })).toBeChecked()
})

test('select all includes folders and expand one level reveals children', async ({ wede }) => {
  const { page } = wede
  await boot(page)

  await page.getByLabel('Select README.md').click({ button: 'right' })
  await page.getByText('Select all', { exact: true }).click()

  await expect(page.getByLabel('Select src')).toHaveAttribute('aria-selected', 'true')

  await page.getByTitle('Expand one level').click()
  await expect(page.getByText('app.js')).toBeVisible()
})
