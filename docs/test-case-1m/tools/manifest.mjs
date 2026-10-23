// Category manifest: folder, TC id prefix, describe title, generator module, number of cases
export const CATEGORIES = [
  { dir: 'scene', prefix: 'SCN', title: 'Scene', count: 100_000 },
  { dir: 'blueprint', prefix: 'BP', title: 'Blueprint', count: 100_000 },
  { dir: 'material', prefix: 'MAT', title: 'Material', count: 80_000 },
  { dir: 'animator', prefix: 'ANM', title: 'Animator', count: 60_000 },
  { dir: 'sequencer', prefix: 'SEQ', title: 'Sequencer', count: 80_000 },
  { dir: 'godot', prefix: 'GDT', title: 'Godot Bridge', count: 100_000 },
  { dir: 'scenefile', prefix: 'FIL', title: 'New / Open / Save / Save As Scene', count: 60_000 },
  { dir: 'settings', prefix: 'SET', title: 'Project Settings', count: 60_000 },
  { dir: 'undo', prefix: 'UND', title: 'Undo / Redo', count: 100_000 },
  { dir: 'gameobject', prefix: 'GOB', title: 'GameObject', count: 60_000 },
  { dir: 'window-input', prefix: 'WIN', title: 'Window + Input Actions', count: 60_000 },
  { dir: 'transform', prefix: 'TRF', title: 'Inspector + Move / Rotate / Scale / 2D', count: 100_000 },
  { dir: 'ui', prefix: 'UI', title: 'Editor UI (Console, Toolbar, Inspector, Windows, Editors)', count: 40_000 },
]
export const PART_SIZE = 5_000
