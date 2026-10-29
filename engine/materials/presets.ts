import { MaterialSpec } from './MaterialSpec'

/**
 * Built-in PBR material presets. Values follow measured/real-world references (metals are
 * metalness 1 with their reflectance as color; dielectrics metalness 0; glass IOR 1.5, water 1.33).
 * Agents list them with linden_material_presets; the Inspector shows them in a dropdown.
 */

export interface MaterialPreset {
  id: string
  label: string
  category: 'wood' | 'metal' | 'plastic' | 'glass' | 'liquid' | 'stone' | 'ceramic' | 'fabric' | 'ground' | 'paint' | 'other'
  description: string
  spec: Omit<MaterialSpec, 'preset'>
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  // Wood
  {
    id: 'wood_oak',
    label: 'Kayu Oak',
    category: 'wood',
    description: 'Oak terang, serat lurus, finishing satin',
    spec: { color: '#b98a57', roughness: 0.55, metalness: 0, tileSize: 0.6, procedural: { kind: 'wood', color2: '#7a5530', contrast: 0.55, bump: 0.2, roughnessVariation: 0.15 } },
  },
  {
    id: 'wood_teak',
    label: 'Kayu Jati',
    category: 'wood',
    description: 'Jati cokelat keemasan, serat rapat, sedikit berminyak',
    spec: { color: '#9a6434', roughness: 0.45, metalness: 0, tileSize: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.4, procedural: { kind: 'wood', color2: '#5c3518', contrast: 0.6, bump: 0.15, roughnessVariation: 0.12 } },
  },
  {
    id: 'wood_walnut',
    label: 'Kayu Walnut',
    category: 'wood',
    description: 'Walnut gelap, serat bergelombang, finishing halus',
    spec: { color: '#5e3c24', roughness: 0.4, metalness: 0, tileSize: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3, procedural: { kind: 'wood', color2: '#2e1b0f', contrast: 0.65, bump: 0.12, roughnessVariation: 0.1 } },
  },
  {
    id: 'wood_painted_white',
    label: 'Kayu Cat Putih',
    category: 'wood',
    description: 'Kayu dicat putih semi-gloss',
    spec: { color: '#ecebe6', roughness: 0.35, metalness: 0, tileSize: 0.6, procedural: { kind: 'wood', contrast: 0.06, bump: 0.05, roughnessVariation: 0.05 } },
  },
  {
    id: 'rattan',
    label: 'Rotan Anyam',
    category: 'wood',
    description: 'Anyaman rotan alami (sandaran/dudukan kursi)',
    spec: { color: '#c79a5c', roughness: 0.7, metalness: 0, tileSize: 0.12, procedural: { kind: 'rattan', color2: '#7d5a2c', contrast: 0.6, bump: 1.4, roughnessVariation: 0.15 } },
  },
  // Metal
  {
    id: 'metal_steel',
    label: 'Baja',
    category: 'metal',
    description: 'Baja polos sedikit kasar',
    spec: { color: '#a8aaad', roughness: 0.35, metalness: 1, tileSize: 0.4, procedural: { kind: 'scratches', contrast: 0.08, bump: 0.15, roughnessVariation: 0.15 } },
  },
  {
    id: 'metal_chrome',
    label: 'Krom',
    category: 'metal',
    description: 'Krom cermin',
    spec: { color: '#e4e6e8', roughness: 0.05, metalness: 1 },
  },
  {
    id: 'metal_gold',
    label: 'Emas',
    category: 'metal',
    description: 'Emas dipoles',
    spec: { color: '#f5c04e', roughness: 0.18, metalness: 1 },
  },
  {
    id: 'metal_copper',
    label: 'Tembaga',
    category: 'metal',
    description: 'Tembaga dipoles dengan sedikit goresan',
    spec: { color: '#e09a6f', roughness: 0.25, metalness: 1, tileSize: 0.4, procedural: { kind: 'scratches', contrast: 0.06, bump: 0.1, roughnessVariation: 0.12 } },
  },
  {
    id: 'metal_aluminium_brushed',
    label: 'Aluminium Brushed',
    category: 'metal',
    description: 'Aluminium sikat dengan pantulan anisotropik',
    spec: { color: '#d3d5d8', roughness: 0.3, metalness: 1, anisotropy: 0.7, tileSize: 0.3, procedural: { kind: 'brushed', contrast: 0.08, bump: 0.25, roughnessVariation: 0.1 } },
  },
  {
    id: 'metal_black_matte',
    label: 'Logam Hitam Doff',
    category: 'metal',
    description: 'Logam berlapis powder coat hitam (rangka lampu, kaki meja)',
    spec: { color: '#2a2b2d', roughness: 0.6, metalness: 0.6, tileSize: 0.3, procedural: { kind: 'noise', contrast: 0.05, bump: 0.1, roughnessVariation: 0.08 } },
  },
  {
    id: 'metal_brass',
    label: 'Kuningan',
    category: 'metal',
    description: 'Kuningan satin',
    spec: { color: '#d6b25e', roughness: 0.3, metalness: 1 },
  },
  // Plastic / rubber
  {
    id: 'plastic_glossy',
    label: 'Plastik Glossy',
    category: 'plastic',
    description: 'Plastik ABS mengilap',
    spec: { color: '#d93a3a', roughness: 0.15, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.1 },
  },
  {
    id: 'plastic_matte',
    label: 'Plastik Doff',
    category: 'plastic',
    description: 'Plastik doff bertekstur halus',
    spec: { color: '#e5e5e5', roughness: 0.65, metalness: 0, tileSize: 0.2, procedural: { kind: 'noise', contrast: 0.03, bump: 0.2, roughnessVariation: 0.05 } },
  },
  {
    id: 'rubber',
    label: 'Karet',
    category: 'plastic',
    description: 'Karet hitam (ban, pegangan)',
    spec: { color: '#1d1d1f', roughness: 0.9, metalness: 0, sheen: 0.2, sheenColor: '#3a3a3a', tileSize: 0.2, procedural: { kind: 'noise', contrast: 0.05, bump: 0.3, roughnessVariation: 0.05 } },
  },
  // Glass / liquid
  {
    id: 'glass_clear',
    label: 'Kaca Bening (tipis)',
    category: 'glass',
    description: 'Kaca tipis bening: gelas minum, botol, jendela, kap. Isi (air) tetap terlihat di dalamnya',
    spec: { color: '#ffffff', roughness: 0.02, metalness: 0, opacity: 0.16, ior: 1.5, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02, doubleSided: true },
  },
  {
    id: 'glass_solid',
    label: 'Kaca Pejal',
    category: 'glass',
    description: 'Kaca tebal/pejal dengan refraksi (balok kaca, pemberat kertas, lensa)',
    spec: { color: '#ffffff', roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5, thickness: 0.05, specularIntensity: 1, attenuationColor: '#e8f4ef', attenuationDistance: 0.5, doubleSided: true },
  },
  {
    id: 'glass_frosted',
    label: 'Kaca Buram',
    category: 'glass',
    description: 'Kaca sandblast (kap lampu, partisi)',
    spec: { color: '#f4f6f7', roughness: 0.45, metalness: 0, transmission: 1, ior: 1.5, thickness: 0.004, doubleSided: true },
  },
  {
    id: 'water',
    label: 'Air',
    category: 'liquid',
    description: 'Air jernih dengan volume (isi gelas, kolam)',
    spec: { color: '#ffffff', roughness: 0.03, metalness: 0, transmission: 1, ior: 1.333, thickness: 0.06, attenuationColor: '#8ccbe0', attenuationDistance: 0.12, doubleSided: true },
  },
  // Ceramic / stone
  {
    id: 'ceramic_glazed',
    label: 'Keramik Glasir',
    category: 'ceramic',
    description: 'Keramik berglasir mengilap (vas, cangkir, piring)',
    spec: { color: '#e9e4da', roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 },
  },
  {
    id: 'ceramic_tile',
    label: 'Ubin Keramik',
    category: 'ceramic',
    description: 'Ubin lantai 30 cm dengan nat',
    spec: { color: '#dcd6cc', roughness: 0.25, metalness: 0, tileSize: 0.6, procedural: { kind: 'tile', color2: '#9a958c', contrast: 0.8, bump: 0.8, roughnessVariation: 0.3 } },
  },
  {
    id: 'marble',
    label: 'Marmer',
    category: 'stone',
    description: 'Marmer putih Carrara dipoles',
    spec: { color: '#eeece8', roughness: 0.12, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.08, tileSize: 1.2, procedural: { kind: 'marble', color2: '#8c8f93', contrast: 0.55, bump: 0.05, roughnessVariation: 0.05 } },
  },
  {
    id: 'concrete',
    label: 'Beton',
    category: 'stone',
    description: 'Beton ekspos',
    spec: { color: '#9d9a95', roughness: 0.85, metalness: 0, tileSize: 2, procedural: { kind: 'concrete', color2: '#77736d', contrast: 0.35, bump: 0.6, roughnessVariation: 0.1 } },
  },
  {
    id: 'brick',
    label: 'Bata Merah',
    category: 'stone',
    description: 'Bata merah 23×7 cm dengan adukan',
    spec: { color: '#9c4a32', roughness: 0.85, metalness: 0, tileSize: 0.5, procedural: { kind: 'brick', color2: '#b8b0a2', contrast: 0.85, bump: 1.2, roughnessVariation: 0.1 } },
  },
  {
    id: 'stone',
    label: 'Batu Alam',
    category: 'stone',
    description: 'Batu alam kasar abu-abu',
    spec: { color: '#807b74', roughness: 0.9, metalness: 0, tileSize: 1.5, procedural: { kind: 'stone', color2: '#4f4b46', contrast: 0.5, bump: 1.5, roughnessVariation: 0.1 } },
  },
  // Fabric / leather
  {
    id: 'fabric_cotton',
    label: 'Kain Katun',
    category: 'fabric',
    description: 'Kain tenun katun (sofa, bantal, taplak)',
    spec: { color: '#5b6f8a', roughness: 0.95, metalness: 0, sheen: 1, sheenRoughness: 0.6, sheenColor: '#c8d0dc', tileSize: 0.05, procedural: { kind: 'fabric', contrast: 0.25, bump: 0.8, roughnessVariation: 0.05 } },
  },
  {
    id: 'fabric_velvet',
    label: 'Beludru',
    category: 'fabric',
    description: 'Beludru dengan kilau sheen kuat',
    spec: { color: '#5a1f2e', roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.3, sheenColor: '#d68a9c', tileSize: 0.3, procedural: { kind: 'noise', contrast: 0.1, bump: 0.2 } },
  },
  {
    id: 'leather',
    label: 'Kulit',
    category: 'fabric',
    description: 'Kulit sapi semi-aniline',
    spec: { color: '#6b3e22', roughness: 0.55, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.5, tileSize: 0.15, procedural: { kind: 'leather', contrast: 0.2, bump: 0.6, roughnessVariation: 0.15 } },
  },
  // Ground
  {
    id: 'grass',
    label: 'Rumput',
    category: 'ground',
    description: 'Rumput pendek (permukaan tanah)',
    spec: { color: '#4f7a2e', roughness: 0.95, metalness: 0, sheen: 0.4, sheenColor: '#9bc96a', tileSize: 1, procedural: { kind: 'grass', color2: '#2f4f1a', contrast: 0.6, bump: 1, roughnessVariation: 0.05 } },
  },
  {
    id: 'soil',
    label: 'Tanah',
    category: 'ground',
    description: 'Tanah gembur cokelat',
    spec: { color: '#6a4b33', roughness: 1, metalness: 0, tileSize: 1.5, procedural: { kind: 'soil', color2: '#3f2b1c', contrast: 0.5, bump: 1.2 } },
  },
  {
    id: 'sand',
    label: 'Pasir',
    category: 'ground',
    description: 'Pasir pantai',
    spec: { color: '#d8c39a', roughness: 0.95, metalness: 0, tileSize: 1, procedural: { kind: 'sand', color2: '#b49c70', contrast: 0.3, bump: 0.8 } },
  },
  // Paint
  {
    id: 'car_paint',
    label: 'Cat Mobil',
    category: 'paint',
    description: 'Cat metalik mobil dengan clearcoat tebal (ganti color untuk warnanya)',
    spec: { color: '#b0101a', roughness: 0.35, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03 },
  },
  {
    id: 'car_paint_pearl',
    label: 'Cat Mobil Pearl',
    category: 'paint',
    description: 'Cat pearl dengan iridescence halus',
    spec: { color: '#f2f2f0', roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.4, iridescenceIOR: 1.4 },
  },
  {
    id: 'paint_wall',
    label: 'Cat Tembok',
    category: 'paint',
    description: 'Cat tembok emulsi doff',
    spec: { color: '#ece6da', roughness: 0.9, metalness: 0, tileSize: 1, procedural: { kind: 'noise', contrast: 0.03, bump: 0.25 } },
  },
  // Other
  {
    id: 'emissive_light',
    label: 'Lampu Menyala',
    category: 'other',
    description: 'Permukaan bohlam/LED yang memancarkan cahaya',
    spec: { color: '#fff3d6', roughness: 0.4, metalness: 0, emissive: '#ffe2a8', emissiveIntensity: 6 },
  },
]

// Containers use alpha-blended thin glass (glass_clear): three renders transmissive meshes (water)
// before transparent ones, so a liquid stays visible through the wall, which a transmissive wall
// would hide. Transmissive presets are double-sided so their back faces reach the transmission pass.

const BY_ID = new Map(MATERIAL_PRESETS.map((p) => [p.id, p]))

export function getMaterialPreset(id: string | undefined): MaterialPreset | undefined {
  return id ? BY_ID.get(id) : undefined
}

/**
 * Effective spec: preset values, then the overrides. Procedural settings merge so an override can
 * change one field (e.g. color2) without dropping the pattern.
 */
export function resolveMaterialSpec(spec: MaterialSpec): { spec: MaterialSpec; warning?: string } {
  const preset = getMaterialPreset(spec.preset)
  if (spec.preset && !preset) {
    return { spec: { ...spec, preset: undefined }, warning: `Preset material "${spec.preset}" tidak dikenal` }
  }
  if (!preset) return { spec }
  const merged: MaterialSpec = { ...preset.spec, ...spec }
  if (preset.spec.procedural || spec.procedural) {
    merged.procedural = { ...(preset.spec.procedural ?? { kind: 'none' }), ...(spec.procedural ?? {}) } as MaterialSpec['procedural']
  }
  return { spec: merged }
}
