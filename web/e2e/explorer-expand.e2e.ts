import { test, expect, seed } from './fixtures.js'

test('Expand one level walks level 1, 2, 3 on repeated clicks', async ({ wede }) => {
  await seed(wede.page, 'authed')
  await wede.page.goto('/')

  const expand = wede.page.getByTitle('Expand one level')

  await expand.click()
  await expect(wede.page.getByText('components', { exact: true })).toBeVisible()
  await expect(wede.page.getByText('Button.tsx', { exact: true })).toHaveCount(0)

  await expand.click()
  await expect(wede.page.getByText('Button.tsx', { exact: true })).toBeVisible()
  await expect(wede.page.getByText('Icon.tsx', { exact: true })).toHaveCount(0)

  await expand.click()
  await expect(wede.page.getByText('Icon.tsx', { exact: true })).toBeVisible()
})

test('folder expansion survives switching to a file and back', async ({ wede }) => {
  const { page } = wede
  await seed(page, 'authed')
  await page.goto('/')

  await page.getByTitle('Expand one level').click()
  await expect(page.getByText('components', { exact: true })).toBeVisible()

  await page.getByText('main.go').click()
  await expect(page.locator('.cm-content')).toContainText('package main')

  await page.getByLabel('Select Files').click()
  await expect(page.getByText('components', { exact: true })).toBeVisible()
})
