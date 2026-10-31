import { meshFromPolygons } from '../../../engine/mesh/core/primitives'
import type { GeomResult } from '../../../engine/mesh/core/result'
import { validateTopology } from '../../../engine/mesh/core/validate'
import { MeshEditor } from '../../../engine/mesh/modeling/MeshEditor'
import { aliveFaces, faceCenter, unitFaceNormal } from '../../../engine/mesh/modeling/topology'

/*
 * Box-modeling test: a stylised low-poly female elf (about 1.8 m, facing +Z) built only with the Edit Mode
 * operations of Phase 3 (extrude, inset, transform, merge), starting from one segmented box. Every step is
 * checked for valid topology. No subdivision yet (Phase 4), so the result is faceted, not realistic.
 */

type Vec3 = [number, number, number]

/** Box from x-splits (quads only), spanning y0..y1 and z0..z1 */
function segmentedBox(xs: number[], y0: number, y1: number, z0: number, z1: number) {
  const pos: number[] = []
  const id = (i: number, top: number, front: number) => (i * 2 + top) * 2 + front
  for (const x of xs) for (const y of [y0, y1]) for (const z of [z0, z1]) pos.push(x, y, z)
  const loops: number[][] = []
  const n = xs.length - 1
  for (let i = 0; i < n; i++) {
    const [a, b] = [i, i + 1]
    loops.push([id(a, 1, 0), id(a, 1, 1), id(b, 1, 1), id(b, 1, 0)]) // top +Y
    loops.push([id(a, 0, 0), id(b, 0, 0), id(b, 0, 1), id(a, 0, 1)]) // bottom -Y
    loops.push([id(a, 0, 1), id(b, 0, 1), id(b, 1, 1), id(a, 1, 1)]) // front +Z
    loops.push([id(a, 0, 0), id(a, 1, 0), id(b, 1, 0), id(b, 0, 0)]) // back -Z
  }
  loops.push([id(0, 0, 0), id(0, 0, 1), id(0, 1, 1), id(0, 1, 0)]) // left -X
  loops.push([id(n, 0, 0), id(n, 1, 0), id(n, 1, 1), id(n, 0, 1)]) // right +X
  return meshFromPolygons(pos, loops)
}

export interface ElfBuild {
  editor: MeshEditor
  steps: { label: string; faces: number }[]
}

export async function buildElf(onStep?: (label: string, editor: MeshEditor) => void): Promise<ElfBuild> {
  const editor = new MeshEditor(segmentedBox([-0.19, -0.06, 0.06, 0.19], 0.88, 1.02, -0.095, 0.095), { historyDepth: 1000 })
  const steps: ElfBuild['steps'] = []
  const sel = editor.selection

  const ok = async (label: string, r: Promise<GeomResult<void>> | GeomResult<void>) => {
    const res = await r
    if (!res.ok) throw new Error(`${label}: ${res.code} ${res.message}`)
    const errors = validateTopology(editor.mesh).filter((i) => i.severity === 'error')
    if (errors.length) throw new Error(`${label}: topology broken: ${errors[0].message}`)
    steps.push({ label, faces: editor.mesh.faceCount })
    onStep?.(label, editor)
  }
  /** Selects faces whose unit normal points along `dir` (dot > 0.7) and whose center passes `where` */
  const pick = (dir: Vec3, where: (c: Vec3) => boolean = () => true): number[] => {
    const faces = aliveFaces(editor.mesh).filter((f) => {
      const n = unitFaceNormal(editor.mesh, f)
      return n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] > 0.7 && where(faceCenter(editor.mesh, f))
    })
    if (faces.length === 0) throw new Error(`no face along ${dir}`)
    sel.set('face', faces)
    return faces
  }
  const extrude = (label: string, d: number) => ok(label, editor.extrude(d))
  const scale = (label: string, s: number | Vec3, pivot: 'median' | 'individual' = 'median') => ok(label, editor.transform({ scale: s }, pivot))
  const move = (label: string, t: Vec3) => ok(label, editor.transform({ translate: t }))
  const rotate = (label: string, axis: Vec3, deg: number) => ok(label, editor.transform({ rotate: { axis, angle: (deg * Math.PI) / 180 } }))

  // ---- legs (outer bottom faces of the pelvis) ----
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R'
    pick([0, -1, 0], (c) => c[0] * s > 0.06)
    await extrude(`${side} hip`, 0.04)
    await scale(`${side} hip shape`, [0.92, 1, 0.95])
    await extrude(`${side} thigh`, 0.4)
    await scale(`${side} knee taper`, [0.72, 1, 0.8])
    await move(`${side} knee inward`, [-s * 0.015, 0, 0.005])
    await extrude(`${side} knee`, 0.05)
    await extrude(`${side} calf`, 0.3)
    await scale(`${side} ankle taper`, [0.7, 1, 0.7])
    await extrude(`${side} ankle`, 0.05)
    await scale(`${side} heel`, [1.05, 1, 1.2])
    // Foot: the front face of the last leg segment goes forward
    pick([0, 0, 1], (c) => c[0] * s > 0.03 && c[1] < 0.1)
    await extrude(`${side} foot`, 0.13)
    await scale(`${side} toes`, [0.85, 0.55, 1])
    await move(`${side} toes down`, [0, -0.02, 0])
  }

  // ---- torso (top of the pelvis, as one region) ----
  pick([0, 1, 0])
  await extrude('waist', 0.14)
  await scale('waist taper', [0.7, 1, 0.8])
  await extrude('ribcage', 0.15)
  await scale('ribcage widen', [1.2, 1, 1.08])
  await extrude('chest', 0.12)
  await scale('shoulders', [1.28, 1, 1.0])
  await extrude('shoulder top', 0.03)
  await scale('shoulder slope', [0.88, 1, 0.9])

  // Bust: the two outer front faces of the ribcage segment
  pick([0, 0, 1], (c) => Math.abs(c[0]) > 0.05 && c[1] > 1.2 && c[1] < 1.34)
  await extrude('bust', 0.055)
  await scale('bust shape', 0.65, 'individual')
  await move('bust lift', [0, 0.01, 0])

  // ---- arms (A-pose): side faces of the chest segment, tilted ~50 degrees down ----
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R'
    pick([s, 0, 0], (c) => c[1] > 1.3 && c[1] < 1.44)
    await extrude(`${side} shoulder`, 0.03)
    await rotate(`${side} arm angle`, [0, 0, 1], -s * 50)
    await scale(`${side} upper arm root`, 0.85)
    await extrude(`${side} upper arm`, 0.27)
    await scale(`${side} elbow taper`, 0.78)
    await extrude(`${side} elbow`, 0.04)
    await extrude(`${side} forearm`, 0.24)
    await scale(`${side} wrist taper`, 0.72)
    await extrude(`${side} wrist`, 0.03)
    await scale(`${side} palm`, [1.1, 1.1, 0.6])
    await extrude(`${side} hand`, 0.09)
    await scale(`${side} fingers`, [0.7, 0.7, 0.7])
  }

  // ---- neck and head (center top face) ----
  pick([0, 1, 0], (c) => Math.abs(c[0]) < 0.03)
  await scale('neck base', [0.85, 1, 0.72])
  await extrude('neck', 0.08)
  await extrude('jaw', 0.03)
  await scale('jaw width', [1.45, 1, 1.75])
  await move('chin forward', [0, 0, 0.012])
  await extrude('cheeks', 0.1)
  await scale('cheekbones', [1.18, 1, 1.1])
  await extrude('temples', 0.08)
  await extrude('crown', 0.05)
  await scale('crown round', [0.72, 1, 0.78])
  await extrude('top of head', 0.02)
  await scale('top close', 0.5)

  // Nose: front face of the cheek segment
  pick([0, 0, 1], (c) => c[1] > 1.58 && c[1] < 1.66 && Math.abs(c[0]) < 0.02)
  await ok('nose inset', editor.inset(0.022))
  await extrude('nose', 0.02)
  await scale('nose narrow', [0.45, 1, 1])
  await move('nose down', [0, -0.012, 0])

  // Pointed elf ears: side faces of the cheek segment, pulled out, up and back, closed to a tip
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R'
    pick([s, 0, 0], (c) => c[1] > 1.58 && c[1] < 1.68)
    await ok(`${side} ear inset`, editor.inset(0.012))
    await extrude(`${side} ear root`, 0.012)
    await scale(`${side} ear root shape`, [1, 0.8, 0.55])
    await extrude(`${side} ear blade`, 0.035)
    await move(`${side} ear sweep`, [s * 0.01, 0.04, -0.03])
    await scale(`${side} ear narrow`, 0.55)
    await extrude(`${side} ear tip`, 0.03)
    await move(`${side} ear tip sweep`, [s * 0.015, 0.05, -0.035])
    await ok(`${side} ear point`, editor.mergeAtCenter())
  }

  // Ponytail: back face of the temple segment, hanging down
  pick([0, 0, -1], (c) => c[1] > 1.68 && c[1] < 1.76)
  await ok('hair tie inset', editor.inset(0.02))
  await extrude('hair tie', 0.03)
  await rotate('ponytail angle', [1, 0, 0], -70)
  await extrude('ponytail 1', 0.12)
  await scale('ponytail 1 taper', 0.85)
  await move('ponytail sway', [0, -0.03, -0.01])
  await extrude('ponytail 2', 0.18)
  await scale('ponytail 2 taper', 0.7)
  await extrude('ponytail 3', 0.15)
  await scale('ponytail end', 0.4)
  await ok('ponytail tip', editor.mergeAtCenter())

  sel.selectNone()
  return { editor, steps }
}
