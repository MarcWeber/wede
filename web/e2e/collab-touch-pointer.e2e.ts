import { test, expect, seed, installBackend, watchForCrashes } from './fixtures'

test.use({ hasTouch: true })

test('a lifted touch keeps its collaborator pointer published', async ({ page }) => {
  const crashes = watchForCrashes(page)
  const sent: Array<{ type?: string; target?: unknown }> = []

  await installBackend(page, {
    collab: (ws) => {
      ws.onMessage((message) => {
        try { sent.push(JSON.parse(String(message)) as { type?: string; target?: unknown }) } catch { /* ignore */ }
      })
      ws.send(JSON.stringify({ type: 'self', id: 'm1' }))
    },
  })
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('long.txt', { exact: true }).click()
  await expect(page.getByText('line 1', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('line 1', { exact: true })).toBeVisible()

  const line = page.locator('.cm-line').nth(2)
  const box = await line.boundingBox()
  expect(box).not.toBeNull()

  const before = sent.length
  await page.touchscreen.tap(box!.x + 30, box!.y + box!.height / 2)
  await expect.poll(() => sent.slice(before).some((m) => m.type === 'pointer' && m.target)).toBe(true)

  const published = sent.findIndex((m, i) => i >= before && m.type === 'pointer' && m.target)
  await page.waitForTimeout(500)
  expect(sent.slice(published + 1).filter((m) => m.type === 'pointer' && m.target === null)).toEqual([])

  await page.locator('.cm-scroller').first().evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect.poll(() => sent.slice(published + 1).some((m) => m.type === 'pointer' && m.target === null)).toBe(true)

  expect(crashes.pageErrors).toEqual([])
})
