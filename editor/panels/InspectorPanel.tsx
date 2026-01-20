import React from 'react'

interface InspectorPanelProps {
  entityId?: string
  onClose?: () => void
}

export const InspectorPanel: React.FC<InspectorPanelProps> = () => {
  // This component is now handled inline in EditorLayout
  // Keeping for backward compatibility
  return null
}

export default InspectorPanel
