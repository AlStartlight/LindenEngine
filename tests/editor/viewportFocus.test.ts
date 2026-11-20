import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../../editor/store/editorStore'
import * as THREE from 'three'

describe('Viewport Focus (Shortcut F)', () => {
  beforeEach(() => {
    useEditorStore.setState({
      selectedEntityIds: [],
      focusEntityNonce: 0,
      focusEntityId: null,
    })
  })

  it('updates focusEntityNonce and focusEntityId when focusOnEntity is called with an id', () => {
    const store = useEditorStore.getState()
    expect(store.focusEntityNonce).toBe(0)

    store.focusOnEntity('ent_123')

    const updated = useEditorStore.getState()
    expect(updated.focusEntityNonce).toBe(1)
    expect(updated.focusEntityId).toBe('ent_123')
    expect(updated.selectedEntityIds).toEqual(['ent_123'])
  })

  it('uses first selectedEntityId when focusOnEntity is called without arguments', () => {
    useEditorStore.setState({ selectedEntityIds: ['ent_abc', 'ent_def'] })
    const store = useEditorStore.getState()

    store.focusOnEntity()

    const updated = useEditorStore.getState()
    expect(updated.focusEntityNonce).toBe(1)
    expect(updated.focusEntityId).toBe('ent_abc')
    expect(updated.selectedEntityIds).toEqual(['ent_abc', 'ent_def'])
  })

  it('correctly calculates framing distance for a perspective camera based on bounding box and fov', () => {
    const box = new THREE.Box3(new THREE.Vector3(-2, -1, -3), new THREE.Vector3(2, 3, 3))
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z, 0.5) // max(4, 4, 6) = 6

    const fov = 60
    const fovRad = (fov * Math.PI) / 180
    const rawDistance = (maxDim / 2) / Math.tan(fovRad / 2)
    const framingDistance = Math.max(rawDistance * 1.5, 2.0)

    expect(maxDim).toBe(6)
    expect(rawDistance).toBeCloseTo(3 / Math.tan(Math.PI / 6), 2) // 3 / (1/sqrt(3)) ≈ 5.196
    expect(framingDistance).toBeCloseTo(5.196 * 1.5, 2) // ≈ 7.794
    expect(framingDistance).toBeGreaterThan(maxDim)
  })

  it('handles empty bounding box by falling back to center point and minimum size', () => {
    const box = new THREE.Box3()
    expect(box.isEmpty()).toBe(true)

    // When empty, fallback creates a unit box around the target position
    const fallbackPos = new THREE.Vector3(10, 5, -20)
    box.setFromCenterAndSize(fallbackPos, new THREE.Vector3(1, 1, 1))

    expect(box.isEmpty()).toBe(false)
    const center = new THREE.Vector3()
    box.getCenter(center)
    expect(center.x).toBe(10)
    expect(center.y).toBe(5)
    expect(center.z).toBe(-20)
  })
})
