import { test, expect, seed } from './fixtures.js'

test('editor background and text follow the theme contrast level', async ({ wede }) => {
  const { page } = wede
  await page.addInitScript(() => {
    if (!localStorage.getItem('wede_theme_level')) localStorage.setItem('wede_theme_level', '1')
  })
  await seed(page, 'authed')
  await page.goto('/')

  const read = async (level: string) => {
    await page.evaluate((v) => localStorage.setItem('wede_theme_level', v), level)
    await page.reload()
    await page.getByText('main.go', { exact: true }).first().click()
    return page.locator('.cm-editor').evaluate((el) => {
      const s = getComputedStyle(el)
      return { background: s.backgroundColor, color: s.color }
    })
  }

  const night = await read('1')
  const highContrast = await read('3.5')
  const evening = await read('5')
  const day = await read('9')

  expect(night.background).toBe('rgb(0, 0, 0)')
  expect(highContrast.background).toBe('rgb(0, 0, 0)')
  expect(highContrast.color).toBe('rgb(255, 255, 255)')
  expect(evening.background).toBe('rgb(30, 30, 30)')
  expect(day.background).toBe('rgb(255, 255, 255)')
  expect(night.color).not.toBe(evening.color)
  expect(highContrast.color).not.toBe(evening.color)
  expect(evening.color).not.toBe(day.color)
})
