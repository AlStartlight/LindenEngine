import { expect } from '@playwright/test'
import { LayerMask } from '../../../engine/scene/LayerMask'
import type { Case } from '../lib/define'
import { freshStore, state } from '../lib/store'
import { TAGS, mulberry32, pick, randInt, seedOf } from '../lib/util'

// Project Settings — 60.000 cases
//   15.000 Add Tag: trimmed, de-duplicated, blank ignored
//   10.000 Remove Tag also strips it from every GameObject (one seed each)
//   10.000 Layers: names reach LayerMask (one seed each)
//      512 Collision matrix: every (layer, layer, value) cell is mirrored
//   24.488 Collision matrix: random toggle sequences stay symmetric (one seed each)
export const COUNT = 60_000

const PADDING = ['', ' ', '  ', '\t', ' \t ']

export function* cases(): Generator<Case> {
  for (let i = 0; i < 3_000; i++) {
    for (let p = 0; p < PADDING.length; p++) {
      const raw = `${PADDING[p]}Tag${i}${PADDING[(p + 2) % PADDING.length]}`
      yield { title: `Add Tag ${JSON.stringify(raw)} stores "Tag${i}" once`, run: () => {
        freshStore()
        const s = state()
        const before = s.projectSettings.tags.length
        s.addProjectTag(raw)
        s.addProjectTag(`Tag${i}`)
        s.addProjectTag('   ')
        const tags = state().projectSettings.tags
        expect(tags.filter((t) => t === `Tag${i}`)).toHaveLength(1)
        expect(tags.length).toBe(before + 1)
        expect(tags.includes('')).toBe(false)
      } }
    }
  }

  for (let s = 0; s < 10_000; s++) {
    const seed = seedOf(701, s)
    yield { title: `Remove Tag strips it from every GameObject seed=${s}`, run: () => {
      freshStore()
      const rng = mulberry32(seed)
      const st = state()
      const victim = pick(rng, TAGS)
      st.addProjectTag(victim)
      for (let i = randInt(rng, 1, 20); i > 0; i--) {
        const e = st.world.createEntity(`E${i}`)
        for (let t = randInt(rng, 0, 4); t > 0; t--) st.world.addTag(e.id, pick(rng, TAGS))
      }
      const others = st.world.getEntities().map((e) => e.tags.filter((t) => t !== victim))
      st.removeProjectTag(victim)
      expect(state().projectSettings.tags.includes(victim)).toBe(false)
      expect(st.world.findByTag(victim)).toEqual([])
      expect(st.world.getEntities().map((e) => e.tags)).toEqual(others)
    } }
  }

  for (let s = 0; s < 10_000; s++) {
    const seed = seedOf(702, s)
    yield { title: `Layers edited in Project Settings reach LayerMask seed=${s}`, run: () => {
      freshStore()
      const rng = mulberry32(seed)
      const layers = Array.from({ length: 32 }, (_, i) => (i < 8 || rng() < 0.4 ? `L${i}_${randInt(rng, 0, 9999)}` : ''))
      state().setProjectLayers(layers)
      expect(state().projectSettings.layers).toEqual(layers)
      layers.forEach((name, i) => {
        if (name) {
          expect(LayerMask.nameToLayer(name)).toBe(i)
          expect(LayerMask.hasLayer(LayerMask.getMask(name), i)).toBe(true)
        }
      })
    } }
  }

  for (let a = 0; a < 16; a++) {
    for (let b = 0; b < 16; b++) {
      for (const value of [false, true]) {
        yield { title: `Collision matrix cell (${a}, ${b}) = ${value} is mirrored to (${b}, ${a})`, run: () => {
          freshStore()
          if (value) state().setCollisionMatrixCell(a, b, false)
          state().setCollisionMatrixCell(a, b, value)
          const m = state().projectSettings.collisionMatrix
          expect(m[a][b]).toBe(value)
          expect(m[b][a]).toBe(value)
        } }
      }
    }
  }

  for (let s = 0; s < 24_488; s++) {
    const seed = seedOf(703, s)
    yield { title: `Collision matrix stays symmetric after random toggles seed=${s}`, run: () => {
      freshStore()
      const rng = mulberry32(seed)
      const model = Array.from({ length: 16 }, () => Array(16).fill(true))
      for (let k = randInt(rng, 1, 30); k > 0; k--) {
        const a = randInt(rng, 0, 15)
        const b = randInt(rng, 0, 15)
        const v = rng() < 0.5
        state().setCollisionMatrixCell(a, b, v)
        model[a][b] = v
        model[b][a] = v
      }
      expect(state().projectSettings.collisionMatrix).toEqual(model)
    } }
  }
}
