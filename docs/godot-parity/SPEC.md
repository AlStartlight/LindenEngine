# SPEC: Godot Feature Parity dengan UX Unity

23 Okt 2026 · Status: Draft · Dokumen terkait: [PRD.md](./PRD.md) · [TEST_CASES.md](./TEST_CASES.md)

Spesifikasi teknis untuk Fase 0 (fondasi) dan Fase 1 (gameplay inti). Fase 2–3 hanya dijelaskan sampai level arsitektur di §12.

Prinsip utama: **ECS `World` adalah satu-satunya sumber kebenaran.** Three.js, Hierarchy, Inspector, file `.lscene`, dan undo/redo semuanya membaca atau mengubah `World` lewat API yang sama. Ini padanan `SceneTree` + `Node` di Godot, disajikan sebagai GameObject + Component ala Unity.

---

## 1. Peta konsep Godot → Linden → Unity UX

| Godot | Linden (kode) | Tampil di UI sebagai (Unity) |
| --- | --- | --- |
| `Node` | `Entity` | GameObject |
| Tipe node (`RigidBody3D`, `Camera3D`) | `Component` (satu entity bisa punya banyak) | Component di Inspector |
| `SceneTree` | `World` + `SceneManager` | Scene di Hierarchy |
| `PackedScene` (`.tscn`) | `SceneAsset` (`.lscene`) & `PrefabAsset` (`.lprefab`) | Scene & Prefab |
| Instanced scene + override | `PrefabInstance` + `PropertyOverride[]` | Prefab biru + Overrides |
| Inherited scene | `PrefabAsset.basePrefab` | Prefab Variant |
| `ClassDB` + `PropertyInfo` | `ComponentRegistry` + `PropertySchema` | Inspector otomatis, Add Component |
| `UndoRedo` / `EditorUndoRedoManager` | `CommandStack` + `EditorCommand` | Edit → Undo/Redo, Undo History |
| Signal + `connect()` | `EventField` + `EventBus` | Event list di Inspector (`+`/`−`) |
| Group | `tags: string[]` (banyak tag per objek) | Field Tags berisi chip + `+` (multi-pilih) |
| Fungsi yang di-`connect` ke signal | Method `@callable()` atau node *Custom Event* Blueprint | Dropdown fungsi di event Inspector |
| Physics layer/mask | `layer: number` + collision matrix | Dropdown Layer + Layer Collision Matrix |
| `InputMap` action | `InputActionMap` | Window → Input Actions |
| Autoload | `PersistentService` | Project Settings → Services |
| `Resource` kustom (`.tres`) | `DataAsset` (`.lasset`) | Project → Create → Data Asset |
| `Timer`, `Tween` | `TimerComponent`, `Tween` | Komponen Timer, API Tween |
| `RigidBody3D` / `StaticBody3D` / `CharacterBody3D` / `Area3D` | `Rigidbody` (dynamic/kinematic/static) / `CharacterController` / `Collider.isTrigger` | Komponen Rigidbody, Collider, Character Controller |

## 2. Arsitektur

```
┌────────────────────────── Editor (React) ───────────────────────────┐
│ Hierarchy   Inspector   Project   Toolbar   Input Actions   Settings │
│      │          │          │         │            │            │     │
│      └──────────┴────┬─────┴─────────┴────────────┴────────────┘     │
│                      ▼                                               │
│            editorStore (zustand)  ◄── selection, playState, dirty     │
│                      │ execute(command)                              │
│                      ▼                                               │
│               CommandStack (undo/redo)                               │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼  World API (addEntity, setProperty, ...)
┌────────────────────── Engine (engine/) ──────────────────────────────┐
│ World ──emits── WorldEvents ──► SceneBridge ──► Three.js scene graph  │
│   │                                     (viewport hanya merender)     │
│   ├─ ComponentRegistry (schema per tipe)                              │
│   ├─ Systems: Physics(Rapier) · Script · Timer/Tween · Input · Render │
│   └─ Serializer (.lscene / .lprefab / .lasset)                        │
└──────────────────────────────────────────────────────────────────────┘
```

Aturan:

1. UI **tidak pernah** mengubah objek Three.js secara langsung. Gizmo transform pun menghasilkan `SetPropertyCommand`.
2. `World` memancarkan event (`entityAdded`, `entityRemoved`, `componentAdded`, `propertyChanged`, `parentChanged`). `SceneBridge` dan panel UI berlangganan event ini.
3. `zustand` (sudah ada di `dependencies`) dipakai untuk state UI editor, bukan untuk data scene.

## 3. F0.1 — Scene model berbasis ECS

### 3.1 Perubahan `Entity` / `World`

```ts
// engine/ecs/Entity.ts
export class Entity {
  readonly id: string            // UUID v4, stabil lintas save/load
  name: string
  active: boolean                // checkbox di header Inspector
  isStatic: boolean
  tags: string[]                 // F1.5 (group Godot)
  layer: number                  // 0..31
  parentId: string | null
  childIds: string[]             // urutan = urutan di Hierarchy
  prefab?: PrefabLink            // F1.1
  // components: Map<typeName, Component> (sudah ada)
}

// engine/ecs/World.ts — API baru
interface World {
  createEntity(name: string, parentId?: string | null, index?: number): Entity
  destroyEntity(id: string): void                 // rekursif ke anak
  setParent(id: string, parentId: string | null, index?: number): void
  addComponent<T extends Component>(id: string, type: string, data?: Partial<T>): T
  removeComponent(id: string, type: string): void
  setProperty(id: string, type: string, path: string, value: unknown): void
  getProperty(id: string, type: string, path: string): unknown
  events: TypedEmitter<WorldEvents>
  findByTag(tag: string): Entity[]                // get_nodes_in_group
}
```

Catatan: transform dunia dihitung dari hierarki parent (seperti `Node3D.global_transform`). `Transform` menyimpan nilai **lokal**.

### 3.2 `SceneBridge`

File baru `engine/scene/SceneBridge.ts`. Memetakan `entityId → THREE.Object3D`.

| WorldEvent | Aksi di Three.js |
| --- | --- |
| `entityAdded` | buat `Object3D` kosong, `parent.add()` |
| `componentAdded('MeshRenderer')` | buat `Mesh` sesuai `primitive`/`mesh`, material |
| `propertyChanged('Transform', ...)` | set `position` / `rotation` (derajat → radian) / `scale` |
| `parentChanged` | `newParent.attach()` bila "keep world transform", selain itu `add()` |
| `entityRemoved` | `dispose()` geometry/material, `remove()` |

`SceneViewport.tsx` hanya memanggil `bridge.attach(scene)` dan raycast mengembalikan `entityId` lewat `object.userData.entityId`.

## 4. F0.2 — Component registry & Inspector otomatis

Padanan `ClassDB::register_class` + `ADD_PROPERTY` di Godot.

```ts
// engine/ecs/ComponentRegistry.ts
export type PropertyKind =
  | 'number' | 'int' | 'boolean' | 'string' | 'color' | 'vector3' | 'enum'
  | 'entityRef' | 'assetRef' | 'layerMask' | 'event' | 'array'

export interface PropertySchema {
  name: string               // path, mis. 'mass'
  label?: string             // default: name → "Title Case"
  kind: PropertyKind
  default: unknown
  min?: number; max?: number; step?: number   // slider bila min & max ada
  options?: string[]         // enum
  assetType?: string         // assetRef
  tooltip?: string
  hideInInspector?: boolean
}

export interface ComponentDefinition {
  type: string               // 'Rigidbody'
  menuPath: string           // 'Physics/Rigidbody' → kategori Add Component
  icon?: string
  properties: PropertySchema[]
  requires?: string[]        // ≈ [RequireComponent] Unity; mis. CharacterController → Transform
  disallowMultiple?: boolean
  create: () => Component
}

export const ComponentRegistry: {
  register(def: ComponentDefinition): void
  get(type: string): ComponentDefinition | undefined
  search(query: string): ComponentDefinition[]   // fuzzy, untuk Add Component
}
```

Script pengguna mendaftarkan properti publik dengan decorator (padanan `@export` GDScript / field publik Unity):

```ts
export class PlayerController extends Behaviour {
  @serialize({ min: 0, max: 20 }) speed = 6
  @serialize() jumpHeight = 1.5
  @serialize({ kind: 'event' }) onDied = new EventField()
}
```

**Inspector** (`editor/panels/InspectorPanel.tsx`) merender per `PropertyKind`:

| Kind | Widget |
| --- | --- |
| `number` / `int` | field angka dengan drag-to-scrub pada label (Unity), slider bila ada min/max |
| `vector3` | tiga field X/Y/Z berwarna merah/hijau/biru |
| `color` | swatch + color picker |
| `enum` | dropdown |
| `entityRef` / `assetRef` | object field + tombol ⊙ picker; menerima drag dari Hierarchy/Project |
| `layerMask` | dropdown multi-pilih "Nothing / Everything / …" |
| `event` | daftar event (§8) |

Multi-select: properti yang nilainya berbeda tampil sebagai `—` (mixed); mengedit satu field mengubah semua objek terpilih dalam **satu** command.

## 5. F0.3 — Undo/Redo

Padanan `UndoRedo::create_action` / `add_do_method` / `add_undo_method` / `commit_action`.

```ts
// editor/commands/CommandStack.ts
export interface EditorCommand {
  label: string                 // tampil di Edit → Undo "Move Cube"
  do(world: World): void
  undo(world: World): void
  mergeKey?: string             // command berturut dengan key sama digabung
}

export class CommandStack {
  execute(cmd: EditorCommand): void   // do() + push, kosongkan redo, set dirty
  undo(): void
  redo(): void
  beginGroup(label: string): void     // ≈ create_action
  endGroup(): void                    // ≈ commit_action
  readonly history: readonly EditorCommand[]
  readonly cursor: number
  markSaved(): void                   // dirty = cursor !== savedCursor
}
```

### 5.1 Penggabungan (merge)

- Drag gizmo: satu command per drag (mouse down → up), bukan per frame.
- Scrub angka di Inspector: perubahan dalam 500 ms dengan `mergeKey` sama (`setProp:<id>:<type>:<path>`) digabung.

### 5.2 Batas

`maxDepth = 200` (dapat diubah di Preferences). Stack dikosongkan saat New/Open Scene. Undo **tidak** aktif di Play mode (Unity: perubahan Play mode tidak masuk Undo).

### 5.3 Operasi yang wajib bisa di-undo

Create, Duplicate (Ctrl+D), Delete, Rename, Reparent/reorder (drag di Hierarchy), Set property (Inspector & gizmo), Add/Remove Component, Reset Component, Paste Component Values, Set active/static/tag/layer, Instantiate Prefab, Unpack Prefab, Apply/Revert override, Add/Remove event listener.

## 6. F0.4 — Format `.lscene` v2

Memperluas format v1 di spec Open Scene. v1 tetap bisa dibaca (migrasi otomatis di `migrateScene()`).

```jsonc
{
  "format": "linden-scene",
  "version": 2,
  "name": "Level01",
  "settings": { "ambientColor": "#666666", "skybox": null },
  "entities": [
    {
      "id": "7f1c…",
      "name": "Player",
      "active": true,
      "static": false,
      "tags": ["Player"],
      "layer": 3,
      "parentId": null,
      "components": [
        { "type": "Transform", "data": { "position": [0, 1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] } },
        { "type": "Rigidbody", "data": { "bodyType": "dynamic", "mass": 1 } },
        { "type": "CapsuleCollider", "data": { "radius": 0.5, "height": 2 } },
        { "type": "script:PlayerController", "data": { "speed": 6 } }
      ]
    },
    {
      "id": "a90e…",
      "name": "Door (1)",
      "prefab": { "asset": "assets/prefabs/Door.lprefab", "overrides": [
        { "target": "root", "component": "Transform", "path": "position", "value": [4, 0, 0] }
      ] }
    }
  ]
}
```

Aturan agar ramah Git (padanan `.tscn` berbasis teks):

- JSON dengan indentasi 2 spasi, kunci diurutkan stabil, satu entity per objek array.
- Entity diurutkan depth-first sesuai Hierarchy, sehingga perubahan kecil = diff kecil.
- Instance prefab hanya menyimpan link + override, **bukan** salinan isi prefab.
- Validasi dengan zod; kode error mengikuti spec Open Scene (`INVALID_JSON`, `SCHEMA_INVALID`, dst.).

Dirty state: `*` di judul jendela & tab Scene; dialog konfirmasi saat New/Open/Quit (spec New Scene).

## 7. F0.5 — Play mode

Padanan menjalankan scene di Godot, tetapi di dalam editor seperti Unity.

| Langkah | Detail |
| --- | --- |
| Play (Ctrl+P) | `snapshot = serializer.serialize(world)` → jalankan `Awake/Start` semua `Behaviour` → mulai loop `fixedUpdate` (50 Hz) + `update` |
| Pause (Ctrl+Shift+P) | Loop berhenti; editor tetap bisa inspect & ubah nilai |
| Step (Ctrl+Alt+P) | Satu frame `fixedUpdate` + `update` |
| Stop | Hentikan loop → `world.clear()` → `serializer.deserialize(snapshot)` → pulihkan seleksi berdasarkan `id` |

UI: tombol Play biru saat aktif; seluruh editor diberi overlay tint (`--play-tint`, dapat diubah di Preferences). Perubahan saat Play tidak di-undo dan tidak menandai dirty.

---

## 8. F1.2 — Signals → Events

### 8.1 Runtime

```ts
// engine/events/EventField.ts
export interface EventListener {
  targetId: string        // entity id
  component: string       // 'script:Door'
  method: string          // 'open'
  args?: unknown[]        // argumen statis (opsional), seperti binds di Godot
  mode: 'runtime' | 'editorAndRuntime' | 'off'
}

export class EventField<TArgs extends unknown[] = []> {
  listeners: EventListener[] = []        // diserialisasi (dari Inspector)
  on(fn: (...a: TArgs) => void): () => void   // listener dari kode, tidak diserialisasi
  emit(...args: TArgs): void
}
```

- Bawaan: `Collider.onTriggerEnter/Exit`, `Collider.onCollisionEnter/Exit`, `Timer.onTimeout`, `Behaviour.onEnable/onDisable`.
- Listener ke entity yang sudah dihapus dilewati dengan warning di Console (Godot: koneksi otomatis putus saat node dibebaskan).
- `emit` sinkron, urutan sesuai daftar. Exception di satu listener dicatat dan tidak menghentikan listener lain.

### 8.2 Inspector (gaya UnityEvent)

```
On Trigger Enter (Collider)
┌──────────────────────────────────────────────────────┐
│ [Runtime Only ▾]  [⊙ Door (1)      ]  [Door.open   ▾]│
│ [Runtime Only ▾]  [⊙ Alarm         ]  [Alarm.ring  ▾]│
└──────────────────────────────────────────────────[+][−]┘
```

Dropdown fungsi menampilkan dua kelompok:

- **Script**: method publik dengan argumen 0–1 bertipe primitif yang ditandai `@callable()`.
- **Blueprint**: setiap node *Custom Event* di graph `Blueprint` milik target (§8.3), mis. `Blueprint ▸ OpenDoor`.

### 8.3 Blueprint sebagai target event (diputuskan)

Saat ini graph hanya punya event bawaan (`EventBeginPlay`, `EventTick`, `EventInputAction`, `EventOnOverlapBegin` di `engine/blueprints/BlueprintGraph.ts`). Ditambahkan:

| Bagian | Perubahan |
| --- | --- |
| Node `EventCustom` (kategori Event) | Properti `eventName` (unik per graph) dan maksimal 1 parameter (`number`/`string`/`boolean`/`entity`). Output: pin exec + pin nilai parameter. Padanan fungsi yang di-`connect` ke signal di Godot. |
| `BlueprintGraph.getCustomEvents()` | `{ name, paramType? }[]`: dipakai Inspector untuk mengisi dropdown fungsi. |
| `BlueprintGraph.executeCustomEvent(name, arg?)` | Mencari node `EventCustom` dengan `eventName` itu lalu `executeFromNode()`. Nama tidak ditemukan → warning di Console, tidak crash. |
| `EventListener` | `component: 'Blueprint'`, `method: '<eventName>'`. `EventField.emit` memanggil `BlueprintComponent.getBlueprint().executeCustomEvent(method, args[0])`. |
| Node `Invoke Event` (P1) | Memanggil `EventField` milik komponen di entity sendiri, sehingga Blueprint juga bisa **memancarkan** event, bukan hanya menerima. |

Aturan:

- Ganti nama Custom Event di Blueprint Editor → semua listener yang memakai nama lama ikut diganti (satu command undo). Hapus node → listener ditandai merah "Missing Blueprint Event".
- Eksekusi Blueprint memakai batas `maxIterations = 10000` yang sudah ada, sehingga event yang memicu loop tak hingga dihentikan dengan error.

## 9. F1.1 — Prefab

### 9.1 Model data

```ts
interface PrefabAsset {          // file .lprefab, isi = subset .lscene dengan satu root
  format: 'linden-prefab'
  version: 1
  basePrefab?: string            // Prefab Variant (inherited scene)
  root: string                   // entity id root
  entities: SerializedEntity[]
}

interface PrefabLink {           // disimpan di entity root instance
  asset: string                  // path relatif project
  overrides: PropertyOverride[]
  addedComponents: SerializedComponent[]
  removedComponents: { target: string; type: string }[]
  addedChildren: SerializedEntity[]
}

interface PropertyOverride {
  target: string                 // 'root' atau id entity di dalam prefab (stabil)
  component: string
  path: string
  value: unknown
}
```

Id entity di dalam instance = `hash(instanceRootId + prefabEntityId)` agar stabil antar-load dan tidak bentrok antar-instance.

### 9.2 Alur

| Aksi | Hasil |
| --- | --- |
| Drag GameObject dari Hierarchy ke Project | Buat `.lprefab`; objek di scene menjadi instance (ikon biru) |
| Drag `.lprefab` ke Hierarchy/Scene view | `InstantiatePrefabCommand` |
| Ubah nilai pada instance | Tersimpan sebagai `PropertyOverride`; label tebal + garis biru |
| Overrides ▾ → Apply All | Tulis override ke `.lprefab`; semua instance di project ter-update saat dibuka |
| Overrides ▾ → Revert All | Hapus override; nilai kembali ke prefab |
| Klik kanan → Prefab → Unpack Completely | Instance jadi GameObject biasa |
| Klik `>` / buka `.lprefab` | **Prefab Mode**: Hierarchy hanya menampilkan isi prefab, breadcrumb di atas Scene view, tombol "Auto Save" |
| Klik kanan prefab → Create → Prefab Variant | `.lprefab` dengan `basePrefab` |

Resolusi nilai: `prefab dasar → variant → override instance` (padanan scene inheritance Godot). Siklus (prefab berisi dirinya sendiri) ditolak dengan error `PREFAB_CYCLE`.

## 10. F1.3 — Physics 3D

### 10.1 Library: Rapier (diputuskan)

Dipakai **Rapier**: `@dimforge/rapier3d-compat` untuk 3D (Fase 1) dan `@dimforge/rapier2d-compat` untuk 2D (Fase 2). Varian `-compat` menyematkan WASM sebagai base64, sehingga jalan di Vite dan Electron tanpa konfigurasi loader WASM.

Alasan: API JS idiomatis, deterministik pada platform yang sama, `KinematicCharacterController` bawaan (padanan `CharacterBody3D.move_and_slide`), dan ada versi 2D dengan API yang sama. Jolt (backend physics Godot di `modules/jolt_physics`) tidak dipilih karena binding Emscripten-nya butuh `destroy()` manual dan tidak punya pasangan 2D.

- Modul dimuat lazy: `await import('@dimforge/rapier3d-compat')` lalu `RAPIER.init()` saat Play pertama atau saat scene pertama kali memiliki Rigidbody/Collider.
- Tetap di belakang interface `PhysicsBackend` agar test integrasi bisa memakai backend palsu dan backend bisa diganti nanti.

### 10.2 Komponen

| Komponen Linden | Padanan Godot | Properti utama |
| --- | --- | --- |
| `Rigidbody` | `RigidBody3D` / `StaticBody3D` / `AnimatableBody3D` | `bodyType: dynamic\|kinematic\|static`, `mass`, `drag`, `angularDrag`, `useGravity`, `freezePosition: [x,y,z]`, `freezeRotation`, `interpolate` |
| `BoxCollider`, `SphereCollider`, `CapsuleCollider`, `MeshCollider` | `CollisionShape3D` + shape | `center`, ukuran, `isTrigger`, `material` (friction, bounciness) |
| `Collider.isTrigger` | `Area3D` | event `onTriggerEnter/Exit` |
| `CharacterController` | `CharacterBody3D` + `move_and_slide` | `height`, `radius`, `slopeLimit`, `stepOffset`; method `move(delta)`, `isGrounded` |
| `Physics.raycast()` | `RayCast3D`, `PhysicsDirectSpaceState3D.intersect_ray` | `(origin, dir, maxDist, layerMask) → RaycastHit \| null` |

Collider tanpa Rigidbody = static collider (perilaku Unity).

### 10.3 Langkah simulasi

- Fixed timestep 1/50 s (Project Settings → Time → Fixed Timestep), maksimal 5 substep per frame.
- Urutan per fixed step: `Behaviour.fixedUpdate` → `backend.step` → sinkron Transform dari body dinamis → kirim event collision/trigger.
- Kinematic body: Transform → body (`setNextKinematicTranslation`).
- Layer Collision Matrix (Project Settings → Physics) dipetakan ke collision groups Rapier (16 bit membership + 16 bit filter). Linden membatasi 16 layer physics.

## 11. F1.4–F1.9

### 11.1 F1.4 Input Actions

`project.linden.json → input.actions`:

```json
{ "name": "Jump", "type": "button", "bindings": ["Keyboard/Space", "Gamepad/ButtonSouth"] }
{ "name": "Move", "type": "vector2", "composite": { "up": "Keyboard/W", "down": "Keyboard/S", "left": "Keyboard/A", "right": "Keyboard/D" }, "bindings": ["Gamepad/LeftStick"], "deadzone": 0.2 }
```

API: `Input.isActionPressed(name)`, `isActionJustPressed`, `isActionJustReleased`, `getVector(name)`, `getAxis(neg, pos)`. Status "just" dihitung per frame `update` (bukan per event). Window → Input Actions: daftar action kiri, binding kanan, tombol **Listen** yang menangkap tombol berikutnya. Gamepad lewat Gamepad API browser dengan mapping `standard`.

### 11.2 F1.5 Tags & Layers

**Tag: banyak per objek (diputuskan)**, seperti group Godot (`Node::add_to_group`), bukan satu tag seperti Unity.

- Data: `entity.tags: string[]`, unik, urutan sesuai urutan di Project Settings.
- UI: di header Inspector, label `Tags` diikuti chip tag yang terpasang (`Enemy ×`, `Flying ×`) dan tombol `+` yang membuka dropdown berpencarian berisi tag project, dengan entri terakhir "Add Tag…". Multi-select objek: chip yang tidak dimiliki semua objek tampil pudar; klik `+` menambahkan tag ke semua.
- API (padanan `SceneTree.get_nodes_in_group`, `call_group`): `world.findByTag('Enemy')`, `world.findByAllTags(['Enemy','Flying'])`, `world.findByAnyTag([...])`, `entity.hasTag()`, `entity.addTag()`, `entity.removeTag()`, `world.callTag('Enemy', 'takeDamage', 10)`.
- `findByTag` memakai indeks `Map<tag, Set<entityId>>` yang diperbarui lewat `WorldEvents`, jadi O(k) terhadap jumlah hasil, bukan O(n).
- Hierarchy: kotak pencarian menerima `t:Enemy` untuk memfilter per tag (seperti `t:` di Unity).
- Menghapus tag yang dipakai menampilkan peringatan berisi jumlah objek.

**Layer** tetap satu per objek (dibutuhkan collision matrix): 32 layer bernama, 0–7 bawaan (Default, TransparentFX, Ignore Raycast, Water, UI). `LayerMask.getMask('Enemy','Ground')`.

### 11.3 F1.6 Persistent Services

Project Settings → Services: daftar `{ name, source: script|prefab, enabled }`. Diinstansiasi sebelum scene pertama di Play mode dan build, di bawah root tersembunyi `DontDestroyOnLoad`, dapat diakses `Services.get<ScoreService>('Score')`. Urutan inisialisasi = urutan daftar (drag untuk mengubah).

### 11.4 F1.7 Data Asset

```ts
@dataAsset({ menuName: 'Game/Weapon Data' })
export class WeaponData extends DataAsset {
  @serialize() damage = 10
  @serialize({ kind: 'assetRef', assetType: 'AudioClip' }) fireSound: AssetRef | null = null
}
```

Project → klik kanan → Create → Game → Weapon Data membuat `.lasset`. Bisa direferensikan dari komponen lewat `assetRef`. Satu instance aset dipakai bersama (seperti `Resource` Godot yang di-share); `asset.duplicate()` untuk salinan.

### 11.5 F1.8 Timer & Tween

`Timer`: `waitTime`, `oneShot`, `autoStart`, `onTimeout: EventField`, method `start()/stop()`. Tween: `Tween.to(target, 'Transform.position', [0,5,0], 1.2, { ease: 'quadOut', delay, loops })` → `TweenHandle` (`kill()`, `then()`); daftar easing mengikuti `scene/animation/easing_equations.h`. Tween terikat entity dan otomatis dihentikan saat entity dihapus.

### 11.6 F1.9 Scene switching

`SceneManager.load(nameOrPath, { mode: 'single' | 'additive' })` (async). Build Settings → Scenes In Build (drag `.lscene`, index 0 = scene awal). Persistent Services tidak ikut dihapus.

## 12. Fase 2–3: arah arsitektur

| Fitur | Catatan arsitektur |
| --- | --- |
| Animation window (F2.1) | `AnimationClip` dengan track `{ entityPath, component, path, keys[] }` mengikuti `scene/resources/animation.h`; Record mode memakai `CommandStack` untuk menangkap perubahan properti menjadi keyframe |
| Blend space (F2.2) | Node baru di `engine/animation/AnimatorController.ts` |
| Navigation (F2.3) | Bake navmesh dengan `recast-navigation` (WASM) di Web Worker |
| Audio Mixer (F2.4) | Web Audio `GainNode` per bus + efek; struktur bus seperti `servers/audio` |
| Build Profiles (F2.5) | `electron-builder` per platform + target Web (output `vite build`) |
| Profiler (F2.6) | `performance.mark` per system per frame, kirim ke panel lewat ring buffer |
| 2D dasar (F2.7) | Tetap satu `World`; render 2D = Three.js `OrthographicCamera` + quad bertekstur (`SpriteRenderer`). Urutan gambar = `sortingLayer` lalu `orderInLayer`, bukan kedalaman z. Scene view tombol "2D" mengunci kamera ke ortografik sumbu XY. Transform 2D = `Transform` dengan z diabaikan untuk physics. |
| Physics 2D (F2.8) | Backend kedua `Rapier2DBackend` di belakang `PhysicsBackend`. Satu entity tidak boleh memakai Rigidbody 2D dan 3D sekaligus (validasi di `requires`/konflik registry). |
| Tilemap (F2.9) | Komponen `Tilemap` menyimpan chunk 16×16 `Uint16Array` (indeks tile) per layer, dirender sebagai satu mesh per chunk. `TilemapCollider2D` menggabungkan tile solid menjadi collider poligon. Aset `TileSet` (`.lasset`) mengikuti `TileSet` Godot: atlas, ukuran tile, collision per tile. |

## 13. Struktur file baru

```
engine/
  ecs/ComponentRegistry.ts      F0.2
  ecs/decorators.ts             @serialize, @callable, @dataAsset
  scene/SceneBridge.ts          F0.1
  scene/serializer.ts           F0.4 (+ migrateScene v1→v2)
  scene/prefab.ts               F1.1
  events/EventField.ts          F1.2
  blueprints/BlueprintNode.ts   + EventCustom, InvokeEvent (F1.2, §8.3)
  physics/PhysicsBackend.ts     F1.3
  physics/RapierBackend.ts      @dimforge/rapier3d-compat (dependency baru)
  physics/components.ts         Rigidbody, *Collider, CharacterController
  input/InputActions.ts         F1.4
  services/Services.ts          F1.6
  assets/DataAsset.ts           F1.7
  time/Timer.ts, time/Tween.ts  F1.8
  scene/SceneManager.ts         F1.9
editor/
  store/editorStore.ts          zustand
  commands/CommandStack.ts      F0.3
  commands/*.ts                 satu file per jenis command
  panels/InspectorPanel.tsx     ditulis ulang, berbasis schema
  panels/inspector/fields/*.tsx widget per PropertyKind
  panels/ProjectPanel.tsx       menggantikan AssetBrowser (2 kolom ala Unity)
  windows/InputActionsWindow.tsx
  windows/ProjectSettingsWindow.tsx  Tags & Layers, Physics, Time, Services, Input
project.linden.json             setting project
```

## 14. Urutan implementasi

1. `ComponentRegistry` + `World` events + `SceneBridge` (F0.1–F0.2), viewport dimigrasikan.
2. `CommandStack` dan seluruh operasi §5.3 (F0.3).
3. Serializer v2 + Save/Open (F0.4), lalu Play mode snapshot (F0.5).
4. Physics (F1.3) dan Input (F1.4): membuka gameplay.
5. Events (F1.2), Tags & Layers (F1.5).
6. Prefab (F1.1): paling kompleks, butuh serializer & undo stabil.
7. Services, Data Asset, Timer/Tween, SceneManager (F1.6–F1.9).

## 15. Lisensi

Godot dirilis di bawah lisensi MIT. Desain diadopsi tanpa menyalin kode. Bila potongan kode diporting (mis. persamaan easing dari `easing_equations.h`), sertakan notice hak cipta Godot di `THIRD_PARTY_NOTICES.md` dan di header file terkait.
