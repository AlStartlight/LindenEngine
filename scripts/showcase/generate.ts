// Builds fixtures/realistic-showcase.lscene and its assets (a GLB model and an HDR environment)
// through the agent tools themselves, so every object passes linden_model_build's validator.
// Run: node scripts/generate-showcase.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as THREE from 'three'
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools'
import { writeGlb } from '../../engine/assets/glbWriter'
import { createMaterial } from '../../engine/materials/createMaterial'

const repo = process.cwd()
const fixtureAssets = path.join(repo, 'fixtures/realistic-showcase/assets')

// ---- HDR: procedural daylight sky (Radiance RGBE, flat scanlines) ---------

function writeSkyHdr(file: string, width = 512, height = 256) {
  const sunDir = new THREE.Vector3(0.45, 0.62, 0.64).normalize()
  const header = Buffer.from(`#?RADIANCE\n# Linden procedural sky\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'latin1')
  const data = Buffer.alloc(width * height * 4)
  const d = new THREE.Vector3()
  for (let y = 0; y < height; y++) {
    const theta = (y / height) * Math.PI
    for (let x = 0; x < width; x++) {
      const phi = (x / width) * Math.PI * 2 - Math.PI
      d.set(Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi))
      let r: number, g: number, b: number
      if (d.y >= 0) {
        // Zenith blue → hazy horizon. No sun disc: direct sunlight (and its shadows) comes from
        // the scene's sun light; a disc here would be added a second time through the IBL.
        const t = Math.pow(1 - d.y, 3)
        r = 0.12 + 0.38 * t
        g = 0.22 + 0.32 * t
        b = 0.5 + 0.2 * t
        const cos = d.dot(sunDir)
        const glow = Math.pow(Math.max(0, cos), 16) * 0.5
        r += glow
        g += glow * 0.9
        b += glow * 0.7
      } else {
        // Warm ground bounce, darker toward the nadir
        const t = Math.min(1, -d.y * 4)
        r = 0.18 - 0.08 * t
        g = 0.15 - 0.07 * t
        b = 0.12 - 0.05 * t
      }
      const max = Math.max(r, g, b)
      const i = (y * width + x) * 4
      if (max < 1e-32) continue
      const e = Math.ceil(Math.log2(max))
      const scale = 256 / Math.pow(2, e)
      data[i] = Math.min(255, Math.floor(r * scale))
      data[i + 1] = Math.min(255, Math.floor(g * scale))
      data[i + 2] = Math.min(255, Math.floor(b * scale))
      data[i + 3] = e + 128
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([header, data]))
}

// ---- GLB: glazed ceramic teapot --------------------------------------------

function writeTeapotGlb(file: string) {
  const geom = new TeapotGeometry(1, 12, true, true, true, false, true)
  geom.computeBoundingBox()
  const bb = geom.boundingBox!
  // Real teapot: ~0.14 m tall
  const scale = 0.14 / (bb.max.y - bb.min.y)
  geom.scale(scale, scale, scale)
  geom.computeBoundingBox()
  geom.translate(0, -geom.boundingBox!.min.y, 0)
  const material = createMaterial({ preset: 'ceramic_glazed', color: '#2f5d8a' })
  material.name = 'GlazedCeramic'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, writeGlb([{ name: 'Teapot', geometry: geom, material }]))
}

// ---- scene through the agent tools -----------------------------------------

const TABLE_TOP = 0.75

const tableModel = {
  category: 'dining_table',
  collider: 'box',
  parts: [
    { id: 'top', name: 'Daun meja', shape: { type: 'roundedBox', size: [1.6, 0.035, 0.9], radius: 0.006 }, position: [0, TABLE_TOP - 0.0175, 0], material: 'wood_teak' },
    { id: 'apron_f', shape: { type: 'roundedBox', size: [1.4, 0.08, 0.022] }, position: [0, TABLE_TOP - 0.035 - 0.04, 0.37], material: 'wood_teak', attachTo: 'top' },
    { id: 'apron_b', shape: { type: 'roundedBox', size: [1.4, 0.08, 0.022] }, position: [0, TABLE_TOP - 0.035 - 0.04, -0.37], material: 'wood_teak', attachTo: 'top' },
    ...[
      [-0.73, -0.38],
      [0.73, -0.38],
      [-0.73, 0.38],
      [0.73, 0.38],
    ].map(([x, z], i) => ({
      id: `leg_${i}`,
      name: 'Kaki meja',
      shape: { type: 'cylinder', radiusTop: 0.03, radiusBottom: 0.022, height: TABLE_TOP - 0.035, radialSegments: 32 },
      position: [x, (TABLE_TOP - 0.035) / 2, z],
      material: 'wood_teak',
      attachTo: 'top',
    })),
  ],
}

const chairModel = {
  category: 'chair',
  collider: 'box',
  parts: [
    { id: 'seat', name: 'Dudukan rotan', shape: { type: 'roundedBox', size: [0.44, 0.03, 0.42], radius: 0.008 }, position: [0, 0.435, 0], material: 'rattan' },
    { id: 'seat_frame', shape: { type: 'roundedBox', size: [0.46, 0.04, 0.44], radius: 0.006 }, position: [0, 0.4, 0], material: 'wood_teak', attachTo: 'seat' },
    ...[
      [-0.2, 0.19],
      [0.2, 0.19],
    ].map(([x, z], i) => ({ id: `front_leg_${i}`, shape: { type: 'roundedBox', size: [0.036, 0.38, 0.036] }, position: [x, 0.19, z], material: 'wood_teak', attachTo: 'seat_frame' })),
    ...[
      [-0.2, -0.19],
      [0.2, -0.19],
    ].map(([x, z], i) => ({
      id: `back_leg_${i}`,
      shape: { type: 'roundedBox', size: [0.036, 0.86, 0.036] },
      position: [x, 0.43, z],
      rotation: [-4, 0, 0],
      material: 'wood_teak',
      attachTo: 'seat_frame',
    })),
    { id: 'backrest', name: 'Sandaran rotan', shape: { type: 'roundedBox', size: [0.37, 0.3, 0.018], radius: 0.006 }, position: [0, 0.68, -0.205], rotation: [-4, 0, 0], material: 'rattan', attachTo: 'back_leg_0' },
    { id: 'top_rail', shape: { type: 'roundedBox', size: [0.44, 0.05, 0.03] }, position: [0, 0.84, -0.215], rotation: [-4, 0, 0], material: 'wood_teak', attachTo: 'back_leg_0' },
  ],
}

const lampModel = {
  category: 'desk_lamp',
  parts: [
    { id: 'base', name: 'Alas', shape: { type: 'cylinder', radiusTop: 0.07, radiusBottom: 0.075, height: 0.02, bevel: 0.004 }, position: [0, 0.01, 0], material: 'metal_black_matte' },
    { id: 'stem', name: 'Tiang', shape: { type: 'tube', path: [[0, 0.018, 0], [0, 0.2, 0], [0.02, 0.32, 0], [0.08, 0.38, 0]], radius: 0.007 }, material: 'metal_chrome', attachTo: 'base' },
    { id: 'joint', shape: { type: 'sphere', radius: 0.014 }, position: [0.08, 0.38, 0], material: 'metal_chrome', attachTo: 'stem', allowOverlap: true },
    {
      id: 'shade',
      name: 'Kap lampu',
      shape: { type: 'lathe', points: [[0.085, 0], [0.07, 0.03], [0.045, 0.07], [0.02, 0.09]], thickness: 0.0015 },
      position: [0.1, 0.3, 0],
      material: { preset: 'metal_black_matte', doubleSided: true },
      attachTo: 'joint',
    },
    { id: 'bulb', name: 'Bohlam', shape: { type: 'sphere', radius: 0.025 }, position: [0.1, 0.345, 0], material: 'emissive_light', allowOverlap: true, attachTo: 'shade', castShadow: false },
  ],
}

const glassModel = {
  category: 'drinking_glass',
  parts: [
    { id: 'glass', name: 'Gelas', shape: { type: 'lathe', points: [[0.03, 0], [0.032, 0.03], [0.0375, 0.12]], thickness: 0.0025, capBottom: true, segments: 64 }, material: 'glass_clear', castShadow: false },
    { id: 'water', name: 'Air', shape: { type: 'lathe', points: [[0.0274, 0.0027], [0.0294, 0.03], [0.0335, 0.085], [0, 0.085]], capBottom: true, segments: 64 }, material: 'water', attachTo: 'glass', castShadow: false },
  ],
}

const vaseModel = {
  category: 'vase',
  parts: [
    {
      id: 'vase',
      name: 'Vas keramik',
      shape: {
        type: 'lathe',
        points: [[0.05, 0], [0.075, 0.04], [0.09, 0.1], [0.08, 0.17], [0.045, 0.23], [0.035, 0.26], [0.045, 0.29]],
        thickness: 0.005,
        capBottom: true,
        segments: 96,
      },
      material: { preset: 'ceramic_glazed', color: '#c9b79a' },
    },
  ],
}

const floorModel = {
  placement: 'floor',
  parts: [{ id: 'floor', name: 'Lantai ubin', shape: { type: 'plane', size: [8, 8] }, material: { preset: 'ceramic_tile', color: '#b9b0a3', tileSize: 1.2 }, castShadow: false }],
}

async function main() {
  fs.mkdirSync(fixtureAssets, { recursive: true })
  writeSkyHdr(path.join(fixtureAssets, 'hdri/studio_sky.hdr'))
  writeTeapotGlb(path.join(fixtureAssets, 'models/teapot.glb'))

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-showcase-'))
  fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'Realistic Showcase', scenesInBuild: ['scenes/Main.lscene'] }))
  fs.cpSync(fixtureAssets, path.join(project, 'assets'), { recursive: true })
  const tool = async (name: string, args: unknown) => {
    const res = await LINDEN_TOOLS[name].execute(project, args as any, {})
    if (!res.success) throw new Error(`${name}: ${res.error}`)
    const issues = res.data?.validation?.issues ?? []
    if (issues.length) throw new Error(`${name} ${JSON.stringify(args).slice(0, 60)}: ${JSON.stringify(issues)}`)
    return res.data
  }

  const hdr = await tool('linden_asset_import', { source: 'assets/hdri/studio_sky.hdr' })
  const teapot = await tool('linden_asset_import', { source: 'assets/models/teapot.glb' })
  console.log('teapot', teapot.size, teapot.triangles, 'tris')

  await tool('linden_model_build', { name: 'Lantai', entityId: 'floor', model: floorModel })
  await tool('linden_model_build', { name: 'Meja Kayu Jati', entityId: 'table', model: tableModel })
  await tool('linden_model_build', { name: 'Kursi Jati Rotan', entityId: 'chair', model: chairModel, position: [0, 0, 0.62], rotation: [0, 180, 0] })
  await tool('linden_model_build', { name: 'Lampu Meja Logam', entityId: 'desk_lamp', model: lampModel, position: [-0.55, TABLE_TOP, -0.2], rotation: [0, 30, 0] })
  await tool('linden_model_build', { name: 'Gelas Air', entityId: 'glass', model: glassModel, position: [0.18, TABLE_TOP, 0.12] })
  await tool('linden_model_build', { name: 'Vas Keramik', entityId: 'vase', model: vaseModel, position: [0.5, TABLE_TOP, -0.18] })
  await tool('linden_model_build', { name: 'Teko Keramik (GLB)', entityId: 'teapot', model: { src: teapot.path, collider: 'box' }, position: [-0.12, TABLE_TOP, -0.05], rotation: [0, -35, 0] })

  // Camera, lamp light and render settings through linden_scene_apply (keeps the built entities)
  const scenePath = path.join(project, 'scenes/Main.lscene')
  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf-8'))
  scene.entities.push(
    {
      id: 'camera',
      name: 'Main Camera',
      parentId: null,
      components: [
        { type: 'Transform', data: { position: [1.9, 1.45, 2.3], rotation: [-18, 40, 0], scale: [1, 1, 1] } },
        { type: 'Camera', data: { fov: 45, near: 0.05, far: 100, isActive: true } },
      ],
    },
    {
      id: 'lamp_light',
      name: 'Cahaya Lampu',
      parentId: 'desk_lamp',
      components: [
        { type: 'Transform', data: { position: [0.1, 0.33, 0], rotation: [-90, 0, 0], scale: [1, 1, 1] } },
        { type: 'Light', data: { type: 'point', color: '#ffd9a0', intensity: 1.5, range: 3, castShadow: false } },
      ],
    }
  )
  await tool('linden_scene_apply', {
    sceneName: 'Realistic Showcase',
    entities: scene.entities,
    settings: {
      environment: hdr.path,
      environmentIntensity: 1,
      skybox: null,
      toneMapping: 'agx',
      exposure: 1,
      shadowQuality: 'high',
      ambientIntensity: 0.05,
      sun: { enabled: true, color: '#fff1dc', intensity: 3, direction: [0.45, 0.62, 0.64] },
      postFx: { enabled: true, ao: true, aoIntensity: 1, bloom: true, bloomStrength: 0.25, bloomThreshold: 1.2, antialias: 'smaa' },
    },
  })

  const play = await LINDEN_TOOLS.linden_play.execute(project, { durationSeconds: 1 } as any, {})
  if (!play.success) throw new Error(`linden_play: ${play.error}`)

  fs.copyFileSync(scenePath, path.join(repo, 'fixtures/realistic-showcase.lscene'))
  fs.rmSync(project, { recursive: true, force: true })
  console.log('wrote fixtures/realistic-showcase.lscene and fixtures/realistic-showcase/assets')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
