import { test, expect, seed } from './fixtures.js'

test('editor background and text follow the theme contrast level', async ({ wede }) => {
  const { page } = wede
  await page.addInitScript(() => {
    if (!localStorage.getItem('wede_theme_level')) localStorage.setItem('wede_theme_level', '4')
  })
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('main.go', { exact: true }).first().click()

  const editor = page.locator('.cm-editor')
  const soft = await editor.evaluate((el) => {
    const s = getComputedStyle(el)
    return { background: s.backgroundColor, color: s.color }
  })

  await page.evaluate(() => localStorage.setItem('wede_theme_level', '6'))
  await page.reload()
  await page.getByText('main.go', { exact: true }).first().click()
  const hard = await editor.evaluate((el) => {
    const s = getComputedStyle(el)
    return { background: s.backgroundColor, color: s.color }
  })

  expect(soft.background).toBe('rgb(0, 0, 0)')
  expect(hard.background).toBe('rgb(0, 0, 0)')
  expect(soft.color).not.toBe(hard.color)
})
