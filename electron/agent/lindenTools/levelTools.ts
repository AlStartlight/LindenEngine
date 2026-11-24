import type { ToolDefinition } from './index'

/**
 * Seeded procedural level synthesis (SPEC-DSH-MCP-Agent-Integration P4).
 *
 * Deterministic rooms + corridors over a tile grid, emitted as ordinary scene
 * entities so the level agent can review them and write the final scene with
 * linden_scene_apply. Same seed + same brief => same entities, always.
 */

interface Room {
  x: number
  z: number
  w: number
  h: number
  cx: number
  cz: number
}

interface Marker {
  gx: number
  gz: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const clampInt = (value: number, min: number, max: number, fallback: number) => {
  const n = Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(min, Math.min(max, n))
}

const THEMES: Record<string, { floor: string; wall: string; hazard: string; loot: string; enemy: string; spawn: string; exit: string; ambient: string; fog: string }> = {
  mars: { floor: '#7a4a34', wall: '#5b3a2a', hazard: '#ff5a36', loot: '#f5b942', enemy: '#b24bf3', spawn: '#38bdf8', exit: '#22c55e', ambient: '#f0b27a', fog: '#c56a3f' },
  cyber: { floor: '#1f2937', wall: '#374151', hazard: '#f43f5e', loot: '#22d3ee', enemy: '#a855f7', spawn: '#38bdf8', exit: '#34d399', ambient: '#60a5fa', fog: '#0f172a' },
  swamp: { floor: '#3f4a2a', wall: '#2f3a22', hazard: '#84cc16', loot: '#fbbf24', enemy: '#7c3aed', spawn: '#67e8f9', exit: '#4ade80', ambient: '#a3b18a', fog: '#2d3a2a' },
  ice: { floor: '#dbeafe', wall: '#93c5fd', hazard: '#f87171', loot: '#fde68a', enemy: '#818cf8', spawn: '#22d3ee', exit: '#4ade80', ambient: '#bfdbfe', fog: '#e0f2fe' },
  volcano: { floor: '#3b1d1d', wall: '#572626', hazard: '#f97316', loot: '#facc15', enemy: '#dc2626', spawn: '#38bdf8', exit: '#22c55e', ambient: '#fb923c', fog: '#451a1a' },
  default: { floor: '#4a5568', wall: '#2d3748', hazard: '#ef4444', loot: '#eab308', enemy: '#8b5cf6', spawn: '#38bdf8', exit: '#22c55e', ambient: '#cbd5e1', fog: '#64748b' },
}

function themeFor(brief: string, explicit?: string): { key: string; palette: (typeof THEMES)['default'] } {
  const key =
    (explicit && THEMES[explicit] ? explicit : undefined) ??
    Object.keys(THEMES).find((k) => k !== 'default' && brief.toLowerCase().includes(k)) ??
    'default'
  return { key, palette: THEMES[key] }
}

interface EntityLike {
  id: string
  name: string
  parentId: null
  active: boolean
  tags: string[]
  components: { type: string; data: Record<string, unknown> }[]
}

function boxEntity(
  id: string,
  name: string,
  tags: string[],
  position: [number, number, number],
  scale: [number, number, number],
  color: string,
  collider: boolean
): EntityLike {
  return {
    id,
    name,
    parentId: null,
    active: true,
    tags,
    components: [
      { type: 'Transform', data: { position, rotation: [0, 0, 0], scale } },
      { type: 'MeshRenderer', data: { primitive: 'box', color } },
      ...(collider ? [{ type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 } } }] : []),
    ],
  }
}

export const LEVEL_TOOLS: Record<string, ToolDefinition> = {
  linden_level_synthesize: {
    name: 'linden_level_synthesize',
    description:
      'Membangun layout level deterministik dari seed + brief: ruangan, koridor, dinding, dan marker spawn/exit/hazard/loot/enemy. ' +
      'TIDAK menulis scene — mengembalikan entities siap dipakai di linden_scene_apply (di level agent, scene_apply ada di scope). ' +
      'Seed dan brief yang sama selalu menghasilkan layout yang sama.',
    parameters: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'Deskripsi level, mis. "kuil es dengan arena boss dan koridor rahasia"' },
        seed: { type: ['string', 'number'], description: 'Seed; default hash dari brief' },
        width: { type: 'number', description: 'Lebar grid (default 21, 11-41)' },
        height: { type: 'number', description: 'Tinggi grid (default 21, 11-41)' },
        tileSize: { type: 'number', description: 'Ukuran tile dalam meter (default 2, 1-6)' },
        theme: { type: 'string', enum: Object.keys(THEMES), description: 'Palet warna; juga dideteksi dari brief' },
        maxEntities: { type: 'number', description: 'Batas entity (default 600)' },
      },
      required: ['brief'],
    },
    async execute(
      _projectPath: string,
      args: { brief: string; seed?: string | number; width?: number; height?: number; tileSize?: number; theme?: string; maxEntities?: number }
    ) {
      try {
        const brief = String(args.brief || '').trim()
        if (!brief) return { success: false, error: 'brief wajib diisi' }

        const width = clampInt(args.width ?? 21, 11, 41, 21) | 1 // keep odd for maze symmetry
        const height = clampInt(args.height ?? 21, 11, 41, 21) | 1
        const tileSize = Math.max(1, Math.min(6, args.tileSize ?? 2))
        const seedValue = args.seed !== undefined ? args.seed : hashSeed(brief)
        const rng = mulberry32(typeof seedValue === 'number' ? seedValue : hashSeed(String(seedValue)))
        const { key: themeKey, palette } = themeFor(brief, args.theme)
        const maxEntities = clampInt(args.maxEntities ?? 600, 20, 2000, 600)

        // 1 = wall, 0 = floor
        const grid: number[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => 1))
        const carve = (x: number, z: number) => {
          if (x > 0 && z > 0 && x < width - 1 && z < height - 1) grid[z][x] = 0
        }

        const rooms: Room[] = []
        for (let attempt = 0; attempt < 40 && rooms.length < 7; attempt++) {
          const w = clampInt(3 + Math.floor(rng() * 4), 3, Math.min(8, width - 2), 4)
          const h = clampInt(3 + Math.floor(rng() * 4), 3, Math.min(8, height - 2), 4)
          const x = 1 + Math.floor(rng() * Math.max(1, width - w - 2))
          const z = 1 + Math.floor(rng() * Math.max(1, height - h - 2))
          const overlaps = rooms.some((r) => x < r.x + r.w + 1 && x + w + 1 > r.x && z < r.z + r.h + 1 && z + h + 1 > r.z)
          if (overlaps) continue
          for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) carve(x + dx, z + dz)
          rooms.push({ x, z, w, h, cx: x + Math.floor(w / 2), cz: z + Math.floor(h / 2) })
        }
        if (rooms.length === 0) {
          for (let z = 2; z < height - 2; z++) for (let x = 2; x < width - 2; x++) carve(x, z)
          rooms.push({ x: 2, z: 2, w: width - 4, h: height - 4, cx: Math.floor(width / 2), cz: Math.floor(height / 2) })
        }

        // Connect room centers in order with L-shaped corridors
        for (let i = 1; i < rooms.length; i++) {
          const a = rooms[i - 1]
          const b = rooms[i]
          const horizontalFirst = rng() < 0.5
          const carveH = (fromX: number, toX: number, z: number) => {
            for (let x = Math.min(fromX, toX); x <= Math.max(fromX, toX); x++) carve(x, z)
          }
          const carveV = (fromZ: number, toZ: number, x: number) => {
            for (let z = Math.min(fromZ, toZ); z <= Math.max(fromZ, toZ); z++) carve(x, z)
          }
          if (horizontalFirst) {
            carveH(a.cx, b.cx, a.cz)
            carveV(a.cz, b.cz, b.cx)
          } else {
            carveV(a.cz, b.cz, a.cx)
            carveH(a.cx, b.cx, b.cz)
          }
        }

        const spawn = rooms[0]
        const exit = rooms[rooms.length - 1]
        const floorCells: Marker[] = []
        for (let z = 1; z < height - 1; z++) for (let x = 1; x < width - 1; x++) if (grid[z][x] === 0) floorCells.push({ gx: x, gz: z })

        const used = new Set<string>([`${spawn.cx},${spawn.cz}`, `${exit.cx},${exit.cz}`])
        const takeCells = (probability: number, count: number): Marker[] => {
          const picked: Marker[] = []
          for (const cell of floorCells) {
            if (picked.length >= count) break
            const key = `${cell.gx},${cell.gz}`
            if (used.has(key)) continue
            if (Math.abs(cell.gx - spawn.cx) + Math.abs(cell.gz - spawn.cz) < 3) continue
            if (rng() > probability) continue
            used.add(key)
            picked.push(cell)
          }
          return picked
        }

        const hazards = takeCells(0.06, 24)
        const loot = takeCells(0.05, 18)
        const enemies = takeCells(0.07, 20)

        const worldX = (gx: number) => (gx - (width - 1) / 2) * tileSize
        const worldZ = (gz: number) => (gz - (height - 1) / 2) * tileSize
        const entities: EntityLike[] = []
        const push = (ent: EntityLike) => {
          if (entities.length < maxEntities) entities.push(ent)
        }

        push(
          boxEntity('syn_floor', 'SynthesizedFloor', ['Ground', 'Synthesized'], [0, -0.1, 0], [width * tileSize, 0.2, height * tileSize], palette.floor, true)
        )

        // Merge horizontal wall runs so a 21x21 arena stays a few dozen entities
        let wallEntities = 0
        for (let z = 0; z < height; z++) {
          let x = 0
          while (x < width) {
            if (grid[z][x] !== 1) {
              x++
              continue
            }
            const start = x
            while (x < width && grid[z][x] === 1) x++
            const runLength = x - start
            push(
              boxEntity(
                `syn_wall_${z}_${start}`,
                `Wall_${z}_${start}`,
                ['Wall', 'Synthesized'],
                [worldX(start) + ((runLength - 1) * tileSize) / 2, 1.5, worldZ(z)],
                [runLength * tileSize, 3, tileSize],
                palette.wall,
                true
              )
            )
            wallEntities++
          }
        }

        const marker = (id: string, name: string, tags: string[], cell: Marker, color: string, scale: number, y: number) =>
          push(
            boxEntity(
              id,
              name,
              [...tags, 'Synthesized'],
              [worldX(cell.gx), y, worldZ(cell.gz)],
              [scale, scale, scale],
              color,
              false
            )
          )

        marker('syn_spawn', 'SpawnPoint', ['Spawn', 'PlayerSpawn'], { gx: spawn.cx, gz: spawn.cz }, palette.spawn, tileSize * 0.4, 0.5)
        marker('syn_exit', 'ExitPortal', ['Exit', 'Goal'], { gx: exit.cx, gz: exit.cz }, palette.exit, tileSize * 0.5, 0.75)
        hazards.forEach((cell, i) => marker(`syn_hazard_${i}`, `Hazard_${i}`, ['Hazard', 'Damage'], cell, palette.hazard, tileSize * 0.35, 0.1))
        loot.forEach((cell, i) => marker(`syn_loot_${i}`, `Loot_${i}`, ['Loot', 'Pickup'], cell, palette.loot, 0.4, 0.6))
        enemies.forEach((cell, i) => marker(`syn_enemy_${i}`, `EnemySpawn_${i}`, ['EnemySpawn', 'Enemy'], cell, palette.enemy, tileSize * 0.4, 0.7))

        const map = grid.map((row, z) => {
          const line = row.map((cell, x) => {
            if (cell === 1) return '#'
            if (z === spawn.cz && x === spawn.cx) return 'S'
            if (z === exit.cz && x === exit.cx) return 'E'
            if (hazards.some((c) => c.gx === x && c.gz === z)) return '!'
            if (loot.some((c) => c.gx === x && c.gz === z)) return '$'
            if (enemies.some((c) => c.gx === x && c.gz === z)) return 'x'
            return '.'
          })
          return line.join('')
        })

        return {
          success: true,
          data: {
            seed: seedValue,
            theme: themeKey,
            brief,
            grid: { width, height, tileSize },
            stats: {
              rooms: rooms.length,
              floorTiles: floorCells.length,
              wallEntities,
              spawns: 1,
              exits: 1,
              hazards: hazards.length,
              loot: loot.length,
              enemySpawns: enemies.length,
              entityCount: entities.length,
            },
            spawn: { x: worldX(spawn.cx), z: worldZ(spawn.cz) },
            exit: { x: worldX(exit.cx), z: worldZ(exit.cz) },
            rationale:
              `Seed ${seedValue}: ${rooms.length} ruangan dihubungkan koridor L. Spawn di ruangan pertama, exit di terakhir. ` +
              'Marker hazard/loot/enemy adalah titik penempatan (tanpa collider); behaviour dipasang oleh programmer/level agent.',
            suggestedSettings: {
              ambientColor: palette.ambient,
              fog: { enabled: true, color: palette.fog, near: 10, far: Math.max(80, Math.max(width, height) * tileSize * 3) },
            },
            map,
            entities,
            nextStep: 'Tulis layout ini dengan linden_scene_apply { scenePath, entities } (pertahankan entity yang sudah ada).',
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}
