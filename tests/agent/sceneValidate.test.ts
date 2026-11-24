import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools'

/**
 * linden_scene_validate — the structural audit the architect and QA agents use
 * before/after touching a scene (SPEC §10).
 */

function withProject(run: (dir: string) => Promise<void> | void) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-validate-'))
    try {
      fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true })
      await run(dir)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

const writeScene = (dir: string, entities: unknown[]) => {
  fs.writeFileSync(
    path.join(dir, 'scenes/Test.lscene'),
    JSON.stringify({ format: 'linden-scene', version: 2, name: 'Test', settings: {}, entities })
  )
}

describe('linden_scene_validate', () => {
  it(
    'passes a well-formed scene',
    withProject(async (dir) => {
      writeScene(dir, [
        { id: 'root', name: 'Root', parentId: null, components: [{ type: 'Transform', data: { position: [0, 0, 0] } }] },
        { id: 'child', name: 'Child', parentId: 'root', components: [{ type: 'Transform' }] },
      ])
      const out = await LINDEN_TOOLS.linden_scene_validate.execute(dir, { scenePath: 'scenes/Test.lscene' })
      expect(out.success).toBe(true)
      expect(out.data.ok).toBe(true)
      expect(out.data.entityCount).toBe(2)
    })
  )

  it(
    'reports duplicate ids, parent cycles, missing parents and missing scripts',
    withProject(async (dir) => {
      writeScene(dir, [
        { id: 'a', name: 'A', parentId: 'b', components: [{ type: 'Transform' }] },
        { id: 'b', name: 'B', parentId: 'a', components: [{ type: 'Transform' }] },
        { id: 'a', name: 'Duplicate A', components: [{ type: 'Transform' }] },
        { id: 'c', name: 'C', parentId: 'nope', components: [{ type: 'Script', data: { src: 'scripts/missing.ts' } }] },
      ])
      const out = await LINDEN_TOOLS.linden_scene_validate.execute(dir, { scenePath: 'scenes/Test.lscene' })
      const codes = out.data.issues.map((i: any) => i.code)
      expect(out.success).toBe(false)
      expect(codes).toContain('LINDEN_E_DUPLICATE_ID')
      expect(codes).toContain('LINDEN_E_PARENT_CYCLE')
      expect(codes).toContain('LINDEN_E_MISSING_PARENT')
      expect(codes).toContain('LINDEN_E_SCRIPT_MISSING')
    })
  )

  it(
    'rejects a scene file that does not exist',
    withProject(async (dir) => {
      const out = await LINDEN_TOOLS.linden_scene_validate.execute(dir, { scenePath: 'scenes/Nope.lscene' })
      expect(out.success).toBe(false)
      expect(out.error).toContain('tidak ditemukan')
    })
  )
})
