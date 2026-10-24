import { describe, it, expect } from 'vitest'
import { useEditorStore } from '../../editor/store/editorStore'
import { GodotBuildRunner } from '../../engine/godot/build/GodotBuildRunner'

describe('Bridge Rename & Interop UX (Spec §3 & Acceptance Criteria)', () => {
  it('migrates legacy "godot" activeEditorPanel to "bridge"', () => {
    const store = useEditorStore.getState()
    store.setActiveEditorPanel('godot' as any)
    expect(useEditorStore.getState().activeEditorPanel).toBe('bridge')

    store.setActiveEditorPanel('bridge')
    expect(useEditorStore.getState().activeEditorPanel).toBe('bridge')
  })

  it('GodotBuildRunner reports error with "Bridge → Godot settings" message', async () => {
    // Provide a non-existent binary path so it fails lookup
    const runner = new GodotBuildRunner('/non/existent/path', '/non/existent/godot_binary_12345')
    const res = await runner.build('Web', '/tmp/out')

    expect(res.success).toBe(false)
    expect(res.error).toContain('Bridge → Godot settings')
    expect(res.error).not.toContain('Godot Bridge settings')
  })
})
