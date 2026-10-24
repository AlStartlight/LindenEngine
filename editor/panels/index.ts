/**
 * Editor Panels Index
 * Export all editor panel components
 */

// Core Editor Panels
export { MaterialEditor } from './MaterialEditor'
export { BlueprintEditor } from './BlueprintEditor'
export { SequencerEditor } from './SequencerEditor'
export { AnimatorEditor } from './AnimatorEditor'
export { GodotPanel } from './GodotPanel'
export { BridgePanel } from './BridgePanel'
export { TransmuterWizard } from './TransmuterWizard'
export { FidelityReportView } from './FidelityReportView'

// Panel Registry for dynamic loading
export const EditorPanels = {
  material: {
    name: 'Material Editor',
    description: 'Node-based material/shader editor (UE5 + Unity style)',
    icon: '🎨',
    component: 'MaterialEditor',
  },
  blueprint: {
    name: 'Blueprint Editor', 
    description: 'Visual scripting system (UE5 style)',
    icon: '📋',
    component: 'BlueprintEditor',
  },
  sequencer: {
    name: 'Sequencer',
    description: 'Timeline-based cinematic editor (UE5 style)',
    icon: '🎬',
    component: 'SequencerEditor',
  },
  animator: {
    name: 'Animator',
    description: 'Animation state machine editor (Unity style)',
    icon: '🏃',
    component: 'AnimatorEditor',
  },
} as const

export type EditorPanelType = keyof typeof EditorPanels
