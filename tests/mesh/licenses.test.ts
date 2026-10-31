import { describe, expect, it } from 'vitest'
import { checkLicenses, GEOMETRY_ROOTS } from '../../scripts/check-licenses.mjs'

describe('geometry stack licenses', () => {
  it('no GPL/LGPL/AGPL package in the dependency closure (outside approved exceptions)', () => {
    const r = checkLicenses()
    expect(r.violations).toEqual([])
    expect(r.checked).toBeGreaterThan(3)
    // Every installed root is covered; three-mesh-bvh arrives in Phase 3
    expect(r.missingRoots.filter((n) => n !== 'three-mesh-bvh')).toEqual([])
    expect(GEOMETRY_ROOTS).toContain('manifold-3d')
  })

  it('exceptions only cover the approved sharp/libvips chain', () => {
    const r = checkLicenses()
    for (const name of r.excepted) expect(name.startsWith('@img/sharp-')).toBe(true)
  })
})
