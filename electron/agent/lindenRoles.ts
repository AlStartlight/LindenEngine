/**
 * Canonical Linden agent roles (P0/P1 of SPEC-DSH-MCP-Agent-Integration).
 *
 * This is the engine's compiled-in copy of `integrations/dsh/agents.json`. The
 * parity test `tests/agent/lindenRolesParity.test.ts` fails when the two drift, so
 * edit both (or edit the JSON and copy here).
 *
 * Tool ids are the bare names returned by the MCP `tools/list` (the server strips
 * the `linden_` prefix); `null` scope means every tool (the OpenCode "director").
 */

export interface LindenAgentRoleDef {
  id: string
  name: string
  order: number
  /** Bare MCP tool names this role may list and call */
  tools: string[]
  /** What the role may write, for docs and diagnostics */
  writes: string[]
}

export const LINDEN_MASTER_ROLE = 'director'

export const LINDEN_AGENT_ROLES: LindenAgentRoleDef[] = [
  {
    id: 'linden-game-architect',
    name: 'Linden Game Architect',
    order: 10,
    tools: [
      'project_info',
      'scene_read',
      'scene_validate',
      'scene_apply',
      'component_list',
      'dimensions',
      'play',
      'snapshot_create',
      'snapshot_list',
      'snapshot_restore',
      'review_gate',
    ],
    writes: ['scenes/*.lscene'],
  },
  {
    id: 'linden-gameplay-programmer',
    name: 'Linden Gameplay Programmer',
    order: 11,
    tools: [
      'project_info',
      'scene_read',
      'component_list',
      'script_write',
      'script_transmute',
      'ui_write',
      'web_write',
      'input_actions',
      'touch_button',
      'play',
      'export_web',
      'script_patch',
      'snapshot_create',
      'snapshot_list',
      'snapshot_restore',
      'review_gate',
    ],
    writes: ['scripts/*', 'ui/*.html', 'web/*', 'project.linden.json (input)'],
  },
  {
    id: 'linden-technical-artist',
    name: 'Linden Technical Artist',
    order: 12,
    tools: [
      'project_info',
      'scene_read',
      'component_list',
      'material_presets',
      'dimensions',
      'model_build',
      'model_bake_glb',
      'factory_write',
      'asset_placeholder',
      'asset_import',
      'render_preview',
      'reference_view',
      'blender_status',
      'blender_build',
      'blender_environment',
      'blender_rig_character',
      'blender_script',
    ],
    writes: ['assets/*', 'models/*'],
  },
  {
    id: 'linden-qa-physics-tester',
    name: 'Linden QA & Physics Tester',
    order: 13,
    tools: [
      'project_info',
      'scene_read',
      'scene_validate',
      'component_list',
      'play',
      'render_preview',
      'play_matrix',
      'snapshot_list',
      'review_gate',
    ],
    writes: [],
  },
  {
    id: 'linden-level-biome-synthesizer',
    name: 'Linden Level & Biome Synthesizer',
    order: 14,
    tools: [
      'project_info',
      'scene_read',
      'scene_validate',
      'scene_apply',
      'component_list',
      'dimensions',
      'material_presets',
      'model_build',
      'asset_placeholder',
      'render_preview',
      'play',
      'input_actions',
      'play_matrix',
      'level_synthesize',
      'snapshot_create',
      'snapshot_list',
      'snapshot_restore',
      'review_gate',
    ],
    writes: ['scenes/*.lscene'],
  },
]

export function roleById(id: string): LindenAgentRoleDef | undefined {
  return LINDEN_AGENT_ROLES.find((r) => r.id === id)
}
