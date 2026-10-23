import { useEditorStore } from '../../../editor/store/editorStore'
import { LayerMask } from '../../../engine/scene/LayerMask'
import { SceneSerializer } from '../../../engine/scene/serializer'

const DEFAULT_SETTINGS = JSON.parse(JSON.stringify(useEditorStore.getState().projectSettings))
const DEFAULT_LAYERS = LayerMask.getLayerNames()

/** Returns the editor store in a fresh state; the store is a module singleton shared by a worker */
export function freshStore() {
  const s = useEditorStore.getState()
  if (s.playState !== 'stopped') useEditorStore.setState({ playState: 'stopped', playSnapshot: null })
  s.newScene()
  useEditorStore.setState({
    projectSettings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    activeWindow: null,
    activeEditorPanel: 'viewport',
    selectedEntityIds: [],
  })
  // setLayerNames() cannot clear a name, so restore the private table directly
  ;(LayerMask as any).layerNames = [...DEFAULT_LAYERS]
  return useEditorStore
}

export const state = () => useEditorStore.getState()

/** Canonical snapshot of the whole scene, used to prove undo restores everything */
export const snapshot = () => SceneSerializer.serialize(state().world, 'Snapshot')
