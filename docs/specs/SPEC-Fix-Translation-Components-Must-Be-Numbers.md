# SPEC: Fix Gagal Memuat Game "The translation components must be numbers."

**Tanggal:** 20 November 2026  
**Status:** Ready for Implementation / Review  
**Target:** `engine/physics/RapierBackend.ts`, `engine/ecs/World.ts`, `engine/scene/serializer.ts`, `engine/physics/components.ts`, `electron/agent/lindenTools/index.ts`  
**Terkait:** [`SPEC-Character-Movement-Input-Controls.md`](./SPEC-Character-Movement-Input-Controls.md), `engine/runtime/GameSimulation.ts`

---

## 1. Ringkasan Masalah

Saat memuat atau menjalankan scene/game tertentu di Linden Engine (melalui editor Game Frame, playmode, atau headless runner `linden_play`), inisialisasi game mengalami kegagalan fatal dengan error runtime:

```text
TypeError: The translation components must be numbers.
    at RigidBodyDesc.setTranslation (node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs)
    at ColliderDesc.setTranslation (node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs)
    at RapierBackend.createCollider (engine/physics/RapierBackend.ts)
    at GameSimulation.initPhysics (engine/runtime/GameSimulation.ts)
```

Error ini mengakibatkan game macet di layar pemuatan (*crash on load*) dengan pesan peringatan konsol / editor toast:
`[Game] Gagal memulai: The translation components must be numbers.`

---

## 2. Gejala & Lingkungan Eksekusi

### 2.1 Gejala
1. Saat user menekan tombol **Play** di editor, viewport menampilkan runtime gagal dimuat:
   `Runtime gagal dimuat atau sesi Play sudah berakhir. Detail ada di Console / DevTools.`
2. Pada konsol editor muncul error:
   `[Game] Gagal memulai: The translation components must be numbers.`
3. Pada headless testing tool AI (`linden_play`), simulasi melempar exception:
   `TypeError: The translation components must be numbers.`

### 2.2 Kondisi Pemicu
Error terjadi ketika sebuah scene memuat entity yang memiliki:
- Komponen collider (`BoxCollider`, `SphereCollider`, `CapsuleCollider`, `MeshCollider`) di mana field `center` atau `size` disimpan dalam format array JSON (misal `center: [0, 0, 0]` atau `size: [1, 1, 1]`) alih-alih objek `{ x, y, z }`.
- Atau `Transform.position`, `Transform.scale`, atau `Transform.rotation` memiliki nilai `undefined`, `null`, string, `NaN`, atau array kosong `[]`.
- Atau generator AI / tool `linden_scene_apply` menulis entity collider dengan data array (misal `center: [0, 0, 0]`).

---

## 3. Akar Masalah (Root Cause Analysis)

### 3.1 Validasi Ketat pada `@dimforge/rapier3d-compat`
Pada library fisika Rapier3D (`dist/rapier.mjs`), fungsi `setTranslation` melakukan validasi tipe eksplisit:

```javascript
setTranslation(A, I, g) {
  if ("number" != typeof A || "number" != typeof I || "number" != typeof g) {
    throw TypeError("The translation components must be numbers.");
  }
  return this.translation = { x: A, y: I, z: g }, this;
}
```

Jika parameter `x`, `y`, atau `z` bernilai `undefined`, `null`, `NaN`, atau bukan bertipe `"number"`, Rapier langsung melempar exception `TypeError("The translation components must be numbers.")`.

### 3.2 Struktur Objek vs Array pada Serialization & Component Data
1. **Definisi Asli Komponen:**
   Di `engine/physics/components.ts`:
   ```typescript
   export abstract class BaseCollider extends Component {
     public center = { x: 0, y: 0, z: 0 }
   }
   export class BoxCollider extends BaseCollider {
     public size = { x: 1, y: 1, z: 1 }
   }
   ```
2. **Penetapan Data pada Deserialisasi (`World.addComponent`):**
   Di `engine/ecs/World.ts`:
   ```typescript
   if (data) {
     for (const [key, value] of entries) {
       ;(comp as any)[key] = value
     }
   }
   ```
   Jika file scene `.lscene` atau payload AI menyertakan `data: { center: [0, -0.5, 0], size: [100, 1, 100] }`:
   Nilai `comp.center` **ditimpa** menjadi Array `[0, -0.5, 0]`.
3. **Akses Properti di `RapierBackend.ts`:**
   Di `engine/physics/RapierBackend.ts`:
   ```typescript
   let cx = collider.center.x // undefined! Karena collider.center adalah Array [0, -0.5, 0]
   let cy = collider.center.y // undefined!
   let cz = collider.center.z // undefined!
   ...
   colDesc.setTranslation(cx, cy, cz) // -> setTranslation(undefined, undefined, undefined) -> THROW!
   ```
   Karena `collider.center` adalah array, properti `.x`, `.y`, dan `.z` bernilai `undefined`. Rapier kemudian menerima `undefined` dan melempar error `The translation components must be numbers.`.
4. **Hal Serupa pada Transform:**
   Di `desc.setTranslation(transform.position.x, transform.position.y, transform.position.z)` atau `staticDesc.setTranslation(...)`:
   Jika `transform.position` berupa array `[x, y, z]` atau memiliki nilai parsial, `transform.position.x` bernilai `undefined`.

---

## 4. Solusi Teknis

Diterapkan pendekatan pertahanan berlapis (*defense-in-depth*) sehingga engine kebal terhadap variasi representasi vektor (baik array `[x, y, z]` maupun objek `{ x, y, z }`, nilai tidak lengkap, `null`, atau string):

### 4.1 Utilitas Konversi Vektor yang Aman (`toVec3`)
Membuat helper sanitasi vektor universal yang menjamin nilai keluaran selalu merupakan objek `{ x: number, y: number, z: number }` dengan komponen yang valid (`Number.isFinite`):

```typescript
export function toVec3(
  v: unknown,
  fallback = { x: 0, y: 0, z: 0 }
): { x: number; y: number; z: number } {
  if (Array.isArray(v)) {
    const x = Number(v[0])
    const y = Number(v[1])
    const z = Number(v[2])
    return {
      x: Number.isFinite(x) ? x : fallback.x,
      y: Number.isFinite(y) ? y : fallback.y,
      z: Number.isFinite(z) ? z : fallback.z,
    }
  }
  if (v && typeof v === 'object') {
    const obj = v as any
    const x = Number(obj.x)
    const y = Number(obj.y)
    const z = Number(obj.z)
    return {
      x: Number.isFinite(x) ? x : fallback.x,
      y: Number.isFinite(y) ? y : fallback.y,
      z: Number.isFinite(z) ? z : fallback.z,
    }
  }
  return { ...fallback }
}
```

### 4.2 Sanitasi pada `RapierBackend.ts`
Seluruh pemanggilan yang berinteraksi dengan translasi Rapier disanitasi menggunakan `toVec3`:
- `createBody`: Membaca `transform.position` via `toVec3(transform.position)`.
- `createCollider`:
  - `collider.center` dibaca via `toVec3(collider.center, { x: 0, y: 0, z: 0 })`.
  - `transform.scale` dibaca via `toVec3(transform.scale, { x: 1, y: 1, z: 1 })`.
  - `collider.size` dibaca via `toVec3(collider.size, { x: 1, y: 1, z: 1 })`.
- `attachCollider`: Membaca `transform.position` via `toVec3(transform.position)`.
- `setTranslation`: Memastikan argumen `pos` disanitasi via `toVec3(pos)`.
- `createModelCollider`: Mengonversi `c.center` dan `shape.center` menjadi vektor angka finite.

### 4.3 Normalisasi pada Komponen Collider & Deserializer
- Pada `engine/ecs/World.ts:addComponent`:
  Saat menetapkan data komponen `BoxCollider`, `SphereCollider`, `CapsuleCollider`, atau `MeshCollider`:
  Jika field `center` atau `size` diberikan dalam bentuk array, otomatis dikonversi menjadi objek `{ x, y, z }`.
- Pada `engine/scene/serializer.ts`:
  Membaca `position`, `rotation`, dan `scale` menggunakan `toVec3` agar tidak menyisakan komponen `undefined` atau `NaN`.
- Pada `electron/agent/lindenTools/index.ts`:
  Memastikan penambahan komponen auto-collider menggunakan format objek standar `{ x, y, z }`.

---

## 5. Rincian Perubahan File

### 5.1 `engine/physics/RapierBackend.ts`
- Tambahkan fungsi helper `toVec3` (diekspor untuk konsistensi).
- Gunakan `toVec3` di:
  - `createBody` (baris ~130)
  - `createCollider` (baris ~180–235)
  - `createModelCollider` (baris ~250–270)
  - `attachCollider` (baris ~290)
  - `setTranslation` (baris ~330)

### 5.2 `engine/ecs/World.ts`
- Di dalam method `addComponent`:
  Tambahkan normalisasi field vektor (`center`, `size`) untuk komponen turunan `BaseCollider` agar jika `data` berisi array `[x, y, z]`, dikonversi menjadi `{ x, y, z }`.

### 5.3 `engine/scene/serializer.ts`
- Di dalam pemrosesan `Transform` saat `deserialize`:
  Gunakan `toVec3` untuk memastikan `t.position`, `t.rotation`, dan `t.scale` selalu berupa objek angka finite.

### 5.4 `electron/agent/lindenTools/index.ts`
- Ubah format `size` dan `center` di auto-ground enrichment menjadi objek `{ x, y, z }` yang terstandarisasi.

---

## 6. Rencana Pengujian & Verifikasi

### 6.1 Unit Tests
Tambahkan pengujian unit di `tests/physics/rapier.test.ts` atau `tests/movement/characterMovement.test.ts`:
1. **Collider Center sebagai Array:**
   Membuat entity dengan `BoxCollider` dengan `center: [0, 1, 0]` dan `size: [2, 2, 2]` (format array). Jalankan `sim.initPhysics()` dan pastikan Rapier berhasil diinisialisasi tanpa error `The translation components must be numbers.`.
2. **Transform Position dengan Nilai Parsial / Array:**
   Membuat entity dengan `position: [5, 2, 0]` atau `{ x: 5, y: 2 }` (tanpa z). Verifikasi `createBody` dan `createCollider` berjalan lancar dengan translasi default yang valid.
3. **SetTranslation dengan Input Array / Non-Number:**
   Memanggil `backend.setTranslation(entity.id, [10, 0, 10] as any)`. Verifikasi tidak ada unhandled exception.

### 6.2 Regression Tests
Jalankan test suite yang ada:
```bash
npx vitest run tests/movement/characterMovement.test.ts tests/scripting/gameSimulation.test.ts tests/physics/rapier.test.ts
npx tsc -p tsconfig.electron.json --noEmit
npm run build:electron
```

---

## 7. Kriteria Selesai (Definition of Done)
1. Scene dengan data collider/transform berbentuk array maupun objek `{ x, y, z }` dapat dimuat dan dijalankan 100% tanpa error `The translation components must be numbers.`.
2. Seluruh unit tests lulus tanpa regresi.
3. Typecheck TypeScript Electron dan build berhasil tanpa error.
