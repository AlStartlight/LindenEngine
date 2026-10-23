/**
 * LIF Schema & Structure Validator
 */

import { LIFProject, LIFScene, LIFNode } from './LIFTypes'

export interface ValidationError {
  path: string
  message: string
}

export class LIFValidator {
  static validate(project: LIFProject): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = []

    if (!project.lifVersion) {
      errors.push({ path: 'lifVersion', message: 'Missing lifVersion' })
    }
    if (!project.sourceEngine || !project.sourceEngine.engine) {
      errors.push({ path: 'sourceEngine', message: 'Missing sourceEngine information' })
    }
    if (!Array.isArray(project.scenes)) {
      errors.push({ path: 'scenes', message: 'Scenes must be an array' })
    } else {
      for (let i = 0; i < project.scenes.length; i++) {
        const scene = project.scenes[i]
        this.validateScene(scene, `scenes[${i}]`, errors)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  private static validateScene(scene: LIFScene, scenePath: string, errors: ValidationError[]): void {
    if (!scene.id) {
      errors.push({ path: `${scenePath}.id`, message: 'Scene missing id' })
    }
    if (!scene.root) {
      errors.push({ path: `${scenePath}.root`, message: 'Scene missing root node' })
      return
    }

    const seenIds = new Set<string>()
    const nodeMap = new Map<string, LIFNode>()

    const collectNodes = (node: LIFNode, nodePath: string) => {
      if (!node.id) {
        errors.push({ path: `${nodePath}.id`, message: 'Node missing id' })
      } else if (seenIds.has(node.id)) {
        errors.push({ path: `${nodePath}.id`, message: `Duplicate node id "${node.id}"` })
      } else {
        seenIds.add(node.id)
        nodeMap.set(node.id, node)
      }

      if (Array.isArray(node.children)) {
        for (let i = 0; i < node.children.length; i++) {
          collectNodes(node.children[i], `${nodePath}.children[${i}]`)
        }
      }
    }

    collectNodes(scene.root, `${scenePath}.root`)

    // Check signal target validity
    for (const [id, node] of nodeMap.entries()) {
      for (const sig of node.signals || []) {
        if (sig.targetNodeId && !nodeMap.has(sig.targetNodeId)) {
          errors.push({
            path: `${scenePath}.nodes[${id}].signals`,
            message: `Signal "${sig.name}" references non-existent targetNodeId "${sig.targetNodeId}"`,
          })
        }
      }
    }
  }
}
