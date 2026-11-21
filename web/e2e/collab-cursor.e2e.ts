import { test, expect, seed, installBackend, watchForCrashes, WORKSPACE_ID } from './fixtures'

test('semantic collaborator cursor follows code lines across viewport sizes', async ({ page }) => {
  const crashes = watchForCrashes(page)
  let send: ((msg: unknown) => void) | null = null

  await installBackend(page, {
    collab: (ws) => {
      send = (msg) => ws.send(JSON.stringify(msg))
      ws.send(JSON.stringify({ type: 'self', id: 'm2' }))
      ws.send(JSON.stringify({
        type: 'presence',
        members: [{ id: 'm2', username: 'alice', color: '#f87171' }],
      }))
    },
  })
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('main.go', { exact: true }).click()
  await expect(page.getByText('package main')).toBeVisible()
  await expect.poll(() => !!send).toBe(true)

  const tab = `${WORKSPACE_ID}\u0000main.go`
  const line = page.locator('.cm-line').nth(2)
  const cursor = page.getByTestId('remote-cursor')
  const nearLine = async () => {
    const a = await line.boundingBox()
    const b = await cursor.boundingBox()
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(Math.abs((b!.y + b!.height / 2) - (a!.y + a!.height / 2))).toBeLessThan(18)
  }

  send!({ type: 'pointer', id: 'm2', target: { kind: 'code', tab, line: 3, col: 5 } })
  await expect(cursor).toBeVisible()
  await nearLine()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('package main')).toBeVisible()
  send!({ type: 'pointer', id: 'm2', target: { kind: 'code', tab, line: 3, col: 5 } })
  await expect(cursor).toBeVisible()
  await nearLine()

  expect(crashes.pageErrors).toEqual([])
})

test('semantic PDF pointer maps to page coordinates', async ({ page }) => {
  const crashes = watchForCrashes(page)
  let send: ((msg: unknown) => void) | null = null

  await installBackend(page, {
    collab: (ws) => {
      send = (msg) => ws.send(JSON.stringify(msg))
      ws.send(JSON.stringify({ type: 'self', id: 'm2' }))
      ws.send(JSON.stringify({
        type: 'presence',
        members: [{ id: 'm2', username: 'alice', color: '#f87171' }],
      }))
    },
  })
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('doc.pdf', { exact: true }).click()
  const canvas = page.getByLabel('PDF page 1')
  await expect(canvas).toBeVisible()
  await expect.poll(() => !!send).toBe(true)

  const tab = `${WORKSPACE_ID}\u0000doc.pdf`
  send!({ type: 'pointer', id: 'm2', target: { kind: 'pdf', tab, page: 1, u: 0.5, v: 0.5 } })
  const cursor = page.getByTestId('remote-cursor')
  await expect(cursor).toBeVisible()

  const a = await canvas.boundingBox()
  expect(a).not.toBeNull()
  const x = Number(await cursor.getAttribute('data-x'))
  const y = Number(await cursor.getAttribute('data-y'))
  expect(Math.abs(x - (a!.x + a!.width / 2))).toBeLessThan(2)
  expect(Math.abs(y - (a!.y + a!.height / 2))).toBeLessThan(2)

  expect(crashes.pageErrors).toEqual([])
})

test('off-screen code pointer pins to the pane edge with a scroll direction', async ({ page }) => {
  const crashes = watchForCrashes(page)
  let send: ((msg: unknown) => void) | null = null

  await installBackend(page, {
    collab: (ws) => {
      send = (msg) => ws.send(JSON.stringify(msg))
      ws.send(JSON.stringify({ type: 'self', id: 'm2' }))
      ws.send(JSON.stringify({
        type: 'presence',
        members: [{ id: 'm2', username: 'alice', color: '#f87171' }],
      }))
    },
  })
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('long.txt', { exact: true }).click()
  await expect(page.getByText('line 1', { exact: true })).toBeVisible()
  await expect.poll(() => !!send).toBe(true)

  const tab = `${WORKSPACE_ID}\u0000long.txt`
  send!({ type: 'pointer', id: 'm2', target: { kind: 'code', tab, line: 150, col: 1 } })
  const cursor = page.getByTestId('remote-cursor')
  await expect(cursor).toBeVisible()
  await expect(cursor).toHaveAttribute('data-offscreen', 'down')

  const pane = page.locator('[data-collab-tab]').first()
  const a = await pane.boundingBox()
  expect(a).not.toBeNull()
  const y = Number(await cursor.getAttribute('data-y'))
  expect(Math.abs(y - (a!.y + a!.height - 14))).toBeLessThan(2)

  expect(crashes.pageErrors).toEqual([])
})

test('semantic image pointer maps to image coordinates', async ({ page }) => {
  const crashes = watchForCrashes(page)
  let send: ((msg: unknown) => void) | null = null

  await installBackend(page, {
    collab: (ws) => {
      send = (msg) => ws.send(JSON.stringify(msg))
      ws.send(JSON.stringify({ type: 'self', id: 'm2' }))
      ws.send(JSON.stringify({
        type: 'presence',
        members: [{ id: 'm2', username: 'alice', color: '#f87171' }],
      }))
    },
  })
  await seed(page, 'authed')
  await page.goto('/')
  await page.getByText('pic.png', { exact: true }).click()
  const img = page.getByAltText('pic.png')
  await expect(img).toBeVisible()
  await expect.poll(() => !!send).toBe(true)

  const tab = `${WORKSPACE_ID}\u0000pic.png`
  send!({ type: 'pointer', id: 'm2', target: { kind: 'image', tab, u: 0.5, v: 0.5 } })
  const cursor = page.getByTestId('remote-cursor')
  await expect(cursor).toBeVisible()

  const a = await img.boundingBox()
  expect(a).not.toBeNull()
  const x = Number(await cursor.getAttribute('data-x'))
  const y = Number(await cursor.getAttribute('data-y'))
  expect(Math.abs(x - (a!.x + a!.width / 2))).toBeLessThan(2)
  expect(Math.abs(y - (a!.y + a!.height / 2))).toBeLessThan(2)

  expect(crashes.pageErrors).toEqual([])
})
