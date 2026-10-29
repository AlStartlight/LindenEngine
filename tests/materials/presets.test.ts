import { describe, it, expect, afterAll } from 'vitest'
import * as THREE from 'three'
import { MATERIAL_PRESETS, getMaterialPreset, resolveMaterialSpec } from '../../engine/materials/presets'
import { MaterialSpecSchema } from '../../engine/materials/MaterialSpec'
import { createMaterial, disposeMaterial, disposeProceduralCache } from '../../engine/materials/createMaterial'
import { generatePattern } from '../../engine/materials/proceduralTextures'

afterAll(() => disposeProceduralCache())

describe('material presets', () => {
  it('has at least 25 valid presets with unique ids covering the required families', () => {
    expect(MATERIAL_PRESETS.length).toBeGreaterThanOrEqual(25)
    const ids = MATERIAL_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of MATERIAL_PRESETS) expect(MaterialSpecSchema.safeParse(p.spec).success, p.id).toBe(true)
    for (const id of ['wood_oak', 'wood_teak', 'wood_walnut', 'metal_steel', 'metal_chrome', 'metal_gold', 'metal_copper', 'metal_aluminium_brushed', 'plastic_glossy', 'plastic_matte', 'rubber', 'glass_clear', 'water', 'ceramic_glazed', 'marble', 'concrete', 'brick', 'fabric_cotton', 'leather', 'grass', 'soil', 'sand', 'stone', 'car_paint']) {
      expect(getMaterialPreset(id), id).toBeDefined()
    }
  })

  it('uses physically plausible values: metals are metallic, glass and water refract with their IOR', () => {
    for (const p of MATERIAL_PRESETS.filter((p) => p.category === 'metal' && p.id !== 'metal_black_matte')) expect(p.spec.metalness, p.id).toBe(1)
    expect(getMaterialPreset('glass_solid')!.spec).toMatchObject({ transmission: 1, ior: 1.5 })
    // Thin container glass is alpha-blended so a liquid inside stays visible
    expect(getMaterialPreset('glass_clear')!.spec).toMatchObject({ ior: 1.5, opacity: expect.any(Number) })
    expect(getMaterialPreset('water')!.spec).toMatchObject({ transmission: 1, ior: 1.333 })
  })

  it('overrides win over the preset and keep its procedural pattern', () => {
    const { spec } = resolveMaterialSpec({ preset: 'wood_teak', color: '#ff0000', procedural: { kind: 'wood', contrast: 0.1 } })
    expect(spec.color).toBe('#ff0000')
    expect(spec.procedural).toMatchObject({ kind: 'wood', contrast: 0.1, color2: '#5c3518' })
    expect(resolveMaterialSpec({ preset: 'nope' }).warning).toMatch(/nope/)
  })

  it('creates MeshPhysicalMaterial only when a physical feature is used', () => {
    const steel = createMaterial({ preset: 'metal_steel' })
    expect(steel.type).toBe('MeshStandardMaterial')
    const paint = createMaterial({ preset: 'car_paint' }) as THREE.MeshPhysicalMaterial
    expect(paint.type).toBe('MeshPhysicalMaterial')
    expect(paint.clearcoat).toBe(1)
    const glass = createMaterial({ preset: 'glass_solid' }) as THREE.MeshPhysicalMaterial
    expect(glass.transmission).toBe(1)
    expect(glass.ior).toBe(1.5)
    const thin = createMaterial({ preset: 'glass_clear' })
    expect(thin.transparent).toBe(true)
    expect(thin.depthWrite).toBe(false)
    const fabric = createMaterial({ preset: 'fabric_cotton' }) as THREE.MeshPhysicalMaterial
    expect(fabric.sheen).toBe(1)
    const alu = createMaterial({ preset: 'metal_aluminium_brushed' }) as THREE.MeshPhysicalMaterial
    expect(alu.anisotropy).toBeGreaterThan(0)
    for (const m of [steel, paint, glass, fabric, alu]) disposeMaterial(m)
  })

  it('Low quality turns transmission into transparency', () => {
    const glass = createMaterial({ preset: 'glass_solid' }, { allowTransmission: false }) as THREE.MeshPhysicalMaterial
    expect(glass.transmission).toBe(0)
    expect(glass.transparent).toBe(true)
    expect(glass.opacity).toBeLessThan(0.5)
  })

  it('procedural maps: color map is sRGB, data maps are linear, repeat follows tileSize', () => {
    const wood = createMaterial({ preset: 'wood_oak' })
    expect(wood.map?.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(wood.normalMap?.colorSpace).toBe(THREE.NoColorSpace)
    expect(wood.roughnessMap?.colorSpace).toBe(THREE.NoColorSpace)
    expect(wood.map?.repeat.x).toBeCloseTo(1 / 0.6)
  })

  it('asset textures get the right color space', () => {
    const seen: Record<string, boolean> = {}
    const mat = createMaterial(
      { color: '#ffffff', textures: { map: 'assets/a.png', normalMap: 'assets/n.png', roughnessMap: 'assets/r.png', aoMap: 'assets/ao.png' } },
      {
        loadTexture: (p, srgb) => {
          seen[p] = srgb
          const t = new THREE.Texture()
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
          return t
        },
      }
    )
    expect(seen).toEqual({ 'assets/a.png': true, 'assets/n.png': false, 'assets/r.png': false, 'assets/ao.png': false })
    expect(mat.map?.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(mat.aoMap?.colorSpace).toBe(THREE.NoColorSpace)
  })

  it('procedural patterns tile seamlessly', () => {
    for (const kind of ['wood', 'noise', 'brick', 'tile', 'fabric', 'brushed', 'scratches', 'marble', 'concrete', 'leather', 'grass', 'soil', 'sand', 'stone', 'rattan'] as const) {
      const f = generatePattern(kind, 64, 3)
      let edge = 0
      let inner = 0
      for (let y = 0; y < 64; y++) {
        edge += Math.abs(f.height[y * 64 + 63] - f.height[y * 64])
        inner += Math.abs(f.height[y * 64 + 32] - f.height[y * 64 + 31])
      }
      // The wrap-around step is no larger than an ordinary neighbouring step (plus slack)
      expect(edge / 64, kind).toBeLessThan(inner / 64 + 0.15)
    }
  })
})
