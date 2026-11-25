import { describe, expect, it } from 'vitest'
import { basePath } from './api'

describe('basePath', () => {
  it('returns an empty prefix at the origin root', () => {
    expect(basePath('/')).toBe('')
  })

  it('preserves a deployment prefix with or without a trailing slash', () => {
    expect(basePath('/foo/')).toBe('/foo')
    expect(basePath('/foo')).toBe('/foo')
  })

  it('uses the parent directory when the URL names a file', () => {
    expect(basePath('/foo/index.html')).toBe('/foo')
  })
})