# SPEC: Integrasi Blender MCP Character Rigging & Animation Pipeline di Linden Engine

Status: **Proposed / In Review**  
Target Branch: `feat/integrate-blender-mcp-for-rigging-character`  
Author: Antigravity Team & Linden Engine Contributors  
Date: 2026-11-19  

---

## 1. Ringkasan Eksekutif

Linden Engine telah memiliki fitur agen **Blender 3D** (`linden_blender_build`, `linden_blender_script`) untuk menghasilkan aset 3D statis (props, level mesh, obstacle) ke dalam format `.glb`. Di sisi lain, Linden Engine juga memiliki komponen `CharacterMovement` yang mengolah input analog keyboard/gamepad/touch serta simulasi kinematic Rapier physics, serta `AnimationPlayer` berbasis Three.js `AnimationMixer`.

Namun, saat ini terdapat kesenjangan besar (**the sliding statue problem**):
1. **Model Karakter Mati**: Blender Bridge v1 secara eksplisit mengecualikan rig dan animasi (`Non-goals: Animasi atau rig dari Blender`), serta memanggil glTF exporter dengan opsi yang tidak dirancang untuk skinned mesh / armatures. Karakter yang dibuat bersifat statis tanpa skeleton.
2. **Karakter Meluncur Tanpa Animasi**: Komponen `CharacterMovement` sama sekali tidak terhubung ke sistem animasi. Saat karakter berjalan, berlari, melompat, atau berjongkok, mesh visual hanya berpindah posisi tanpa ada pergerakan tubuh (tidak bernafas, tidak mengayun kaki/tangan).
3. **Ketiadaan Pipeline Rigging & Locomotion Otomatis**: Agent AI maupun pengembang tidak memiliki tool terstandarisasi untuk membuat skeleton/armature bipedal, melakukan skinning (vertex weights), dan membangkitkan set animasi dasar (Idle, Walk, Run, Jump, Fall, Land, Crouch, Attack) secara otomatis.

**Tujuan Spec Ini:**
Menyediakan pipeline end-to-end terintegrasi antara **Blender MCP Bridge** dan **Linden Engine Runtime** untuk menghidupkan karakter:
- **Di sisi Blender (`blender-bridge`)**: Menambahkan sistem procedural armature generation (Humanoid/Biped Standard), auto-skinning (heat/automatic weights & multi-part rigid binding), serta generator action/locomotion procedural keyframes (Idle, Walk, Run, Jump, Fall, Land, Crouch, Attack) yang diekspor bersih ke `.glb`.
- **Di sisi MCP Agent Tools**: Menyediakan tool MCP `linden_blender_rig_character` dan memperluas declarative spec di `shared/blenderSpec.ts` sehingga Agent AI dapat membuat dan menganimasikan karakter dalam satu instruksi prompt.
- **Di sisi Linden Engine Runtime (ECS & Physics)**: Menghadirkan komponen `CharacterAnimator` yang secara otomatis mengawasi telemetry `CharacterMovement` (kecepatan, orientasi, status grounded, vertical velocity, crouching) dan melakukan transisi halus (crossfade) serta penyesuaian kecepatan animasi (speed-sync) untuk mengeliminasi foot-sliding.
- **Di sisi Editor**: Inspeksi rig/tulang di Hierarchy & Inspector panel, pemilih klip animasi visual, dan live preview di editor viewport.

---

## 2. Analisis Kondisi Eksisting & Masalah (Gap Analysis)

| Area | Kondisi Saat Ini | Masalah / Keterbatasan | Kebutuhan Solusi |
|---|---|---|---|
| **Blender Bridge Runner** (`blender-bridge/runner.py`) | Memanggil `bpy.ops.export_scene.gltf(..., export_apply=True)`. Menghapus objek non-mesh. | `export_apply=True` merusak armature deform modifier pada skinned mesh. Tulang (armature) dan NLA actions diabaikan saat ekspor. | Ekspor glTF harus mendukung `export_animations=True`, `export_skins=True`, dan seleksi armature hierarchy tanpa merusak modifier. |
| **Spesifikasi Model** (`shared/blenderSpec.ts`) | Hanya mendukung primitive mesh (`cube`, `cylinder`, dll.), modifier geometris, dan material PBR dasar. | Tidak ada skema deklaratif untuk mendefinisikan armature, proporsi bipedal, atau animasi locomotion. | Tambahkan blok `rig` dan `animation` ke dalam `BlenderSpecSchema`. |
| **Tool Agent MCP** (`electron/agent/lindenTools/blenderTools.ts`) | Hanya ada `linden_blender_build` dan `linden_blender_script`. | Agent harus menulis ratusan baris Python boilerplate bpy yang rawan crash jika ingin merig karakter. | Sediakan tool terdedikasi `linden_blender_rig_character` dengan template bipedal humanoid standar. |
| **Runtime Movement** (`engine/movement/CharacterMovement.ts`) | Menghitung vektor kecepatan, coyote time, jump buffer, orientasi kamera, dan Rapier kinematic character controller. | Zero connection ke `AnimationPlayer` atau visual mesh. | Komponen jembatan (`CharacterAnimator`) yang mendengarkan state telemetry `CharacterMovement`. |
| **Sistem Animasi Engine** (`engine/animation/AnimationPlayer.ts`, `AnimationTree.ts`) | `AnimationPlayer.attachMixer` dapat memutar klip Three.js, tetapi pergantian antar klip harus dipanggil manual via script game. `AnimationTree` bersifat pasif. | Tidak ada automated locomotion state machine bawaan untuk karakter pemain/NPC. | Integrasi state machine locomotion berbasis blend weights dan crossfading di runtime. |

---

## 3. Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   AGENT / USER PROMPT                                   │
│            "Buat karakter robot/ksatria yang hidup, bisa jalan, lari, dan lompat"       │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   LINDEN MCP SERVER                                     │
│  1. linden_blender_build / linden_blender_rig_character                                 │
│     - Menghasilkan model mesh + Humanoid Armature + Automatic Weights                  │
│     - Merekam 8 NLA Locomotion Actions (Idle, Walk, Run, Jump, Fall, Land, Crouch...)   │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ Ekspor GLB (Skins + Armatures + Animations)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ASSET PIPELINE & GLB                                    │
│  assets/models/character.glb (SkinnedMesh + THREE.Skeleton + AnimationClips)            │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           LINDEN ENGINE ECS SCENE HIERARCHY                             │
│                                                                                         │
│  Entity "Player"                                                                        │
│   ├── TransformComponent (Position, Rotation, Scale)                                    │
│   ├── CharacterMovement (WASD / Analog Touch / Physics Controller)                      │
│   │     telemetry: speed, isGrounded, velocity.y, isSprinting, isCrouching              │
│   ├── ModelComponent (src: "assets/models/character.glb")                               │
│   └── CharacterAnimator (Komponen Baru)                                                 │
│         ├── State Machine: Idle ⇄ Walk ⇄ Run ⇄ Jump ⇄ Fall ⇄ Land ⇄ Crouch             │
│         ├── Speed-Sync Engine: playbackSpeed = currentSpeed / baseWalkSpeed             │
│         └── Drives AnimationPlayer (Three.js AnimationMixer crossfade)                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Spesifikasi Sisi Blender (`blender-bridge`)

### 4.1 Standar Hierarki Tulang Humanoid (Standard Biped Skeleton)
Untuk memastikan interoperabilitas antara Three.js, glTF, dan game engine standard, hierarki tulang menggunakan konvensi Humanoid Biped standar:

```
Root (Bone)
 └── Pelvis / Hips
      ├── Spine
      │    └── Chest
      │         ├── Neck
      │         │    └── Head
      │         ├── Clavicle.L ── UpperArm.L ── Forearm.L ── Hand.L
      │         └── Clavicle.R ── UpperArm.R ── Forearm.R ── Hand.R
      ├── Thigh.L ── Shin.L ── Foot.L ── Toe.L
      └── Thigh.R ── Shin.R ── Foot.R ── Toe.R
```

*Aturan Orientasi Bone:*
- Sumbu Y-axis tulang mengarah dari head ke tail (arah panjang tulang).
- Sumbu Z-axis tulang mengarah ke depan / ventral.
- Sumbu X-axis mengarah ke lateral (kiri/kanan).

### 4.2 Mode Rigging & Binding

Blender Bridge runner mendukung dua strategi skinning:
1. **Organic / Smooth Deform (`auto_weights`)**:
   - Cocok untuk model humanoid utuh ber-topologi terhubung (organik, manusia, monster).
   - Memanggil `bpy.ops.object.parent_set(type='ARMATURE_AUTO')` dengan kalkulasi heat maps.
   - Dilengkapi fallback: jika terdapat non-manifold geometry yang menyebabkan auto-weight gagal, runner mengaplikasikan voxel/envelope weight sederhana agar eksekusi tidak gagal fatal.
2. **Segmented / Mechanical Binding (`bone_parenting`)**:
   - Cocok untuk robot, low-poly modular, atau objek rakitan parts (dari `BlenderSpec` multi-object).
   - Setiap objek/part di-bind 100% ke tulang terdekatnya (misal part `head_mesh` ter-parent ke bone `Head`, part `lower_leg_l` ter-parent ke bone `Shin.L`).
   - Mencegah distorsi tekstur atau deformasi "karet" pada karakter robotik/mekanikal.

### 4.3 Procedural Locomotion Action Library
Runner menyediakan pustaka keyframe prosedural internal dalam Python (`blender-bridge/rigging/locomotion.py`) untuk menghasilkan action glTF tanpa memerlukan dependensi file eksternal:

| Nama Klip | Tipe Playback | Durasi Default | Parameter & Karakteristik Gerakan |
|---|---|---|---|
| `Idle` | Loop | 2.4 detik | Hips bernafas vertikal (0.02m), rotasi spine lembut, subtle head swaying, arm balance micro-drifts. |
| `Walk` | Loop | 1.0 detik | Siklus jalan bipedal 2 langkah lengkap. Pelvis bob 2x per siklus, arm-leg opposite swing (30°), ankle roll (lift heel, plant heel). |
| `Run` / `Sprint` | Loop | 0.65 detik | Pelvis condong ke depan (forward lean 12°), ayunan tangan tinggi (55°), lutut terangkat lebih tinggi, stride length lebih panjang. |
| `Jump_Start` | Once | 0.25 detik | Anticipation crouch (0.1s) diikuti ekstensi kaki penuh ke bawah dan lengan terangkat. |
| `Jump_Loop` / `Fall`| Loop | 0.6 detik | Kaki menekuk rileks, lengan menahan keseimbangan di udara, slight aerodynamic tilt. |
| `Land` | Once | 0.2 detik | Shock absorption cushion (pelvis drops 0.12m, lutut menekuk) lalu kembali ke netral. |
| `Crouch_Idle` | Loop | 2.0 detik | Pelvis turun 40%, punggung membungkuk, nafas pendek. |
| `Crouch_Walk` | Loop | 1.2 detik | Langkah pendek merayap dengan profil tubuh tetap rendah. |
| `Attack_Melee` | Once | 0.6 detik | Anticipation winding, forward thrust/slash tangan kanan, recovery. |

### 4.4 Modifikasi Runner Exporter (`blender-bridge/runner.py`)
Pada runner eksisting:
```python
# SEBELUM (merusak rig)
bpy.ops.export_scene.gltf(
    filepath=opts["out"], export_format="GLB", export_apply=True,
    use_selection=True, export_yup=True,
)
```
Diperbarui menjadi:
```python
# SESUDAH (mendukung armatures & animations)
has_armature = any(o.type == "ARMATURE" for o in bpy.context.scene.objects)
bpy.ops.export_scene.gltf(
    filepath=opts["out"],
    export_format="GLB",
    export_apply=not has_armature,  # Jangan apply modifier jika ada armature!
    export_animations=True,
    export_animation_mode="ACTIONS", # Ekspor semua actions individual
    export_skins=True,
    export_morph=True,
    export_def_bones=True,
    use_selection=False,
    export_yup=True,
)
```

---

## 5. Spesifikasi Skema Data & MCP Tools

### 5.1 Ekstensi `shared/blenderSpec.ts`
Menambahkan definisi `RigSchema` ke dalam konfigurasi deklaratif:

```ts
export const RigBoneMappingSchema = z.object({
  bone: z.string(),
  objectName: z.string(),
})

export const CharacterRigSpecSchema = z.object({
  type: z.enum(['humanoid_biped', 'mechanical_biped', 'custom']),
  height: z.number().positive().max(50).default(1.8), // tinggi karakter dalam meter
  symmetry: z.boolean().default(true),
  autoSkin: z.boolean().default(true),
  rigMapping: z.array(RigBoneMappingSchema).optional(), // untuk mechanical binding
  generateLocomotion: z.boolean().default(true),
  actions: z.array(z.enum([
    'idle', 'walk', 'run', 'jump', 'fall', 'land', 'crouch_idle', 'crouch_walk', 'attack'
  ])).default(['idle', 'walk', 'run', 'jump', 'fall', 'land', 'crouch_idle', 'crouch_walk']),
})

export type CharacterRigSpec = z.infer<typeof CharacterRigSpecSchema>
```

Objek root `BlenderSpecSchema` diperluas dengan field opsional `rig`:
```ts
export const BlenderSpecSchema = z.object({
  objects: z.array(ObjectSchema).min(1).max(64),
  ground: z.boolean().optional(),
  join: z.boolean().optional(),
  rig: CharacterRigSpecSchema.optional(), // <--- Ditambahkan
})
```

### 5.2 Tool MCP Baru: `linden_blender_rig_character`

Tool MCP yang ditambahkan ke `electron/agent/lindenTools/blenderTools.ts`:

- **Nama**: `linden_blender_rig_character`
- **Deskripsi**: "Menerapkan rigging bipedal, skinning, dan menghasilkan paket animasi locomotion (Idle, Walk, Run, Jump, Fall, Land, Crouch) pada model karakter yang ada di assets/ atau dari spec Blender."
- **Parameter Skema**:
  ```ts
  {
    name: string,                      // Nama karakter, e.g. "Knight", "RobotWorker"
    sourceModel?: string,              // Path model eksisting (misal: "assets/models/raw_robot.glb")
    spec?: BlenderSpec,                // Alternatif: langsung generate dari spec
    rigType?: 'humanoid_biped' | 'mechanical_biped',
    height?: number,                   // Tinggi karakter dalam meter (default: 1.8)
    actions?: string[],                // List aksi yang digenerate (default: full locomotion set)
    target?: string,                   // Path output .glb tujuan di assets/models/
  }
  ```
- **Return Value**:
  ```json
  {
    "success": true,
    "path": "assets/models/Knight_Rigged.glb",
    "bonesCount": 22,
    "animations": ["Idle", "Walk", "Run", "Jump_Start", "Fall", "Land", "Crouch_Idle", "Crouch_Walk"],
    "triangles": 14200,
    "suggestedSetup": {
      "components": ["CharacterMovement", "CharacterAnimator"]
    }
  }
  ```

---

## 6. Spesifikasi Runtime Linden Engine (ECS & Locomotion Controller)

### 6.1 Komponen Baru: `CharacterAnimator`
File: `engine/animation/CharacterAnimator.ts`

Komponen ECS ini menjadi "otak animator" yang secara reaktif menggerakkan karakter berdasarkan fisikanya:

```ts
import { Component } from '../ecs/Component'

export interface LocomotionClipsConfig {
  idle: string
  walk: string
  run: string
  jumpStart: string
  fall: string
  land: string
  crouchIdle: string
  crouchWalk: string
}

export class CharacterAnimator extends Component {
  // Pemetaan nama klip ke animasi glTF
  public clips: LocomotionClipsConfig = {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    jumpStart: 'Jump_Start',
    fall: 'Fall',
    land: 'Land',
    crouchIdle: 'Crouch_Idle',
    crouchWalk: 'Crouch_Walk',
  }

  // Parameter transisi & blending
  public fadeDuration = 0.2          // Durasi crossfade antar state (detik)
  public walkThreshold = 0.15        // Kecepatan minimal untuk masuk state Walk (m/s)
  public runThreshold = 5.0          // Ambang batas kecepatan untuk masuk state Run (m/s)
  public syncPlaybackSpeed = true    // Scale animation speed mengikuti kecepatan gerak
  public baseWalkSpeed = 3.5         // Kecepatan gerak referensi 1.0x playback speed
  public baseRunSpeed = 7.0          // Kecepatan lari referensi 1.0x playback speed

  // Runtime private states
  _currentState: 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land' | 'crouch' = 'idle'
  _isLanding = false
  _landingTimer = 0

  constructor() {
    super('CharacterAnimator')
  }
}
```

### 6.2 Logika State Machine Locomotion (`GameSimulation.ts`)
Setiap frame (`update`), `GameSimulation` atau `SceneBridge` mengevaluasi kondisi pergerakan karakter:

```
                          ┌─────────────┐
        ┌────────────────►│    IDLE     │◄────────────────┐
        │                 └──────┬──────┘                 │
        │ speed < 0.15           │ speed > 0.15           │
        │                        ▼                        │
        │                 ┌─────────────┐                 │
        ├─────────────────┤    WALK     │                 │
        │                 └──────┬──────┘                 │
        │                        │ speed >= runThreshold  │
        │                        ▼                        │
        │                 ┌─────────────┐                 │
        ├─────────────────┤     RUN     ├─────────────────┤
        │                 └─────────────┘                 │
        │                                                 │
        │          !isGrounded && vy > 1.0                │
        │   ┌─────────────────────────────────────────┐   │
        │   │                                         ▼   │
  ┌─────┴───────┐                             ┌───────────┴─┐
  │    LAND     │◄────────────┐               │ JUMP_START  │
  └─────────────┘             │               └──────┬──────┘
         ▲                    │                      │ vy <= 0.0
         │ isGrounded         │                      ▼
         │                    │               ┌─────────────┐
         └────────────────────┴───────────────┤    FALL     │
                                              └─────────────┘
```

*Aturan State Transition:*
1. **Airborne Priority**:
   - Jika `!movement.isGrounded`:
     - Jika `velocity.y > 0.5` -> Mainkan `clips.jumpStart` (clamp at end frame).
     - Jika `velocity.y <= 0.5` -> Crossfade ke `clips.fall` (looping).
2. **Landing Event**:
   - Saat state sebelumnya berada di udara (`fall` atau `jump`), dan frame ini `movement.isGrounded == true`:
     - Picu state `land` (durasi 0.18 detik, non-loop).
     - Setelah landing timer usai, kembali ke evaluasi ground locomotion.
3. **Ground Locomotion**:
   - Jika `movement.isCrouching`:
     - `speed > walkThreshold` -> `clips.crouchWalk`.
     - `speed <= walkThreshold` -> `clips.crouchIdle`.
   - Jika normal (berdiri):
     - `speed < walkThreshold` -> Crossfade ke `clips.idle`.
     - `walkThreshold <= speed < runThreshold` -> Crossfade ke `clips.walk`.
     - `speed >= runThreshold` (atau `movement.isSprinting`) -> Crossfade ke `clips.run`.
4. **Anti-Foot-Sliding (Dynamic Speed Scaling)**:
   - Jika sedang state `walk`: `animationPlayer.playbackSpeed = Math.max(0.5, currentSpeed / baseWalkSpeed)`.
   - Jika sedang state `run`: `animationPlayer.playbackSpeed = Math.max(0.7, currentSpeed / baseRunSpeed)`.
   - Kaki karakter menjejak tanah secara sinkron dengan perpindahan transform fisik, tidak terlihat meluncur di lantai.

---

## 7. Integrasi UI Editor & Inspector Panel

1. **Inspector Panel - `CharacterAnimator` Section**:
   - File: `editor/panels/CharacterAnimatorSection.tsx`
   - Menampilkan slot konfigurasi klip dengan dropdown otomatis dari nama klip yang terdeteksi di model `.glb`.
   - Menampilkan status telemetry live saat Play Mode (Current State: `WALK`, Speed: `4.2 m/s`, Playback Rate: `1.2x`).
2. **Visual Skeleton Toggle**:
   - Opsi di toolbar Viewport: **Show Skeletons** (`THREE.SkeletonHelper`). Memungkinkan pengguna melihat pose tulang di editor 3D secara visual.
3. **Editor Animation Preview Scrubber**:
   - Di tab Inspector saat memilih node karakter, sediakan mini-scrubber untuk memutar dan memverifikasi klip animasi langsung di editor tanpa perlu menekan tombol Play.

---

## 8. Rencana Implementasi & Milestone

| Milestone | Target Pekerjaan | Output / Verifikasi |
|---|---|---|
| **M0: Spike & Validasi API Blender** | Uji `bpy` 4.2+ / 5.x untuk armature creation, vertex weights, NLA action stashing, dan ekspor glTF skinned mesh. | Skrip spike python menghasilkan `.glb` ber-rig yang sukses dimuat Three.js tanpa error. |
| **M1: Locomotion Generator di Bridge** | Implementasi `blender-bridge/rigging/locomotion.py` (Idle, Walk, Run, Jump, Fall, Land, Crouch actions generator). Modifikasi `runner.py` flag exporter. | Runner mengekspor GLB bipedal beranimasi lengkap dan lulus validasi triangles/bones. |
| **M2: Skema & MCP Tools** | Tambahkan `RigSchema` di `shared/blenderSpec.ts`, buat tool `linden_blender_rig_character`, daftarkan di `blenderTools.ts`. | Test unit vitest `blenderTools.test.ts` & parsing schema zod. |
| **M3: Runtime `CharacterAnimator`** | Buat `engine/animation/CharacterAnimator.ts` dan hubungkan telemetry `CharacterMovement` di `GameSimulation.ts` & `SceneBridge.ts`. | Karakter di scene 3D otomatis berjalan, berlari, melompat, dan landing saat digerakkan WASD/joystick. |
| **M4: Editor UI & Inspector** | Tambahkan `CharacterAnimatorSection` di Inspector dan dukungan `SkeletonHelper` di viewport editor. | User dapat memetakan dan menguji klip langsung dari UI editor Linden. |
| **M5: Agent Prompts & Integrasi End-to-End** | Update `electron/agent/prompts/blender.md` dengan panduan pembuatan karakter hidup, tes e2e lengkap. | Prompt agent "buat karakter robot yang bisa jalan dan lompat" menghasilkan entitas lengkap yang hidup seketika. |

---

## 9. Keamanan, Lisensi, dan Batasan Sistem

1. **Isolasi Lisensi (GPL-3.0 vs MIT)**:
   - Kode yang memakai `bpy` (Blender API) ditempatkan secara ketat di dalam direktori `blender-bridge/` (berlisensi GPL-3.0-or-later).
   - Core engine Linden, MCP tools di Electron, dan runtime ECS tetap berlisensi MIT.
   - Komunikasi hanya berlangsung via child-process `spawn`, parameter CLI, dan file JSON/GLB tanpa import library langsung.
2. **Batas Beban Skeletal (Mobile & WebGPU Limits)**:
   - Maksimal 64 bones per karakter standar (standar industri untuk WebGL/WebGPU skinning uniform limit 4 bone influences per vertex).
   - Maksimal 16 aksi per model untuk menjaga ukuran file `.glb` tetap ringan (< 15 MB).
   - Validasi timeout 120 detik per eksekusi rigging di Blender.

---

## 10. Kriteria Keberhasilan (Acceptance Criteria)

- [ ] File spesifikasi disetujui dan terdokumentasi rapi di `docs/specs/SPEC-Blender-Character-Rigging-Animation.md`.
- [ ] Tersedia skema deklaratif rig di `shared/blenderSpec.ts`.
- [ ] Tool MCP `linden_blender_rig_character` terdaftar dan dapat dipanggil oleh AI Agent.
- [ ] File output `.glb` dari Blender Bridge mempertahankan skeletal mesh dan action tracks yang kompatibel dengan Three.js.
- [ ] Komponen `CharacterAnimator` di Linden Engine mampu mengendalikan transisi animasi karakter secara dinamis berdasarkan input dan fisika `CharacterMovement`.
- [ ] Tidak terjadi *foot sliding* berkat sinkronisasi playback speed adaptif.
- [ ] Seluruh perubahan dikomit dan dipush ke branch `feat/integrate-blender-mcp-for-rigging-character`.
