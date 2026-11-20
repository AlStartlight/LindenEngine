# SPEC: Shortcut 'F' untuk Focus / Zoom In pada Objek Terpilih di Workspace Linden Engine

**Tanggal:** 21 November 2026  
**Status:** Ready for Implementation / Review  
**Target:** `editor/viewport/SceneViewport.tsx`, `editor/store/editorStore.ts`, `editor/EditorLayout.tsx`, `editor/panels/HierarchyPanel.tsx`  
**Terkait:** [`SPEC-Character-Movement-Input-Controls.md`](./SPEC-Character-Movement-Input-Controls.md), `SceneBridge.ts`

---

## 1. Ringkasan & Latar Belakang

Pada editor 3D modern (seperti Blender `Numpad .`, Unity `F`, Unreal `F`, Godot `F`), fitur **Focus / Frame Selected** adalah salah satu shortcut navigasi paling fundamental. Fitur ini memungkinkan pengguna untuk langsung mengarahkan kamera dan zoom-in ke objek atau entitas yang sedang dipilih (`selectedEntityIds`), sekaligus memusatkan titik rotasi orbit kamera (`OrbitControls.target`) ke objek tersebut.

### Kondisi Saat Ini di Linden Engine
1. Saat pengguna memilih entity di **Hierarchy** atau mengklik objek di **Scene Viewport**, kamera editor tetap berada di posisinya dan pivot orbit tetap di titik sebelumnya (default `(0, 0, 0)` atau titik manual).
2. Jika objek berada jauh dari pusat koordinat (misal pada koordinat `(100, 10, -50)` atau objek kecil yang di-generate AI), pengguna harus melakukan panning dan zooming manual yang lambat dan melelahkan untuk menemukan objek tersebut.
3. Shortcut `W` (Translate), `E` (Rotate), `R` (Scale), dan `U` (Toggle UI Overlay) sudah tersedia di viewport, namun tombol **`F`** untuk Frame/Focus pada objek belum diimplementasikan di mode navigasi objek (Scene Viewport). Di Edit Mesh Mode, tombol `F` digunakan khusus untuk Fill/Bridge.

---

## 2. Tujuan & User Stories

### 2.1 User Stories
- **Sebagai game developer / level designer**, saya ingin menekan tombol **`F`** saat memilih sebuah entity agar kamera viewport secara instan atau halus meluncur (zoom in) dan memusatkan pandangan ke objek tersebut.
- **Sebagai pengguna yang menginspeksi hierarki**, saya ingin dapat melakukan **double-click** atau klik kanan **Focus (F)** pada item entitas di Hierarchy Panel agar kamera langsung meluncur ke objek tersebut di viewport.
- **Setelah fokus**, saat saya memutar kamera menggunakan tombol klik kanan/tengah mouse (`OrbitControls`), kamera berotasi mengelilingi pusat objek tersebut, bukan mengelilingi titik nol dunia yang jauh.

### 2.2 Batasan & Non-Tujuan
- Saat entitas sedang berada di **Mesh Edit Mode** (`meshEdit !== null`), tombol `F` tetap dipertahankan untuk fungsi mesh editing bawaan (*Fill / Bridge*). Shortcut Focus `F` hanya aktif pada **Object / Scene Navigation Mode**.
- Saat kursor berada di elemen input teks (`input`, `textarea`, `select`, atau `isContentEditable`), tombol `F` tidak boleh memicu navigasi kamera melainkan mengetikkan karakter biasa.

---

## 3. Spesifikasi Perilaku & Interaksi (UX)

### 3.1 Pemicu Shortcut (Triggers)
1. **Tombol Keyboard `F` (Viewport Focus):**
   - Menekan tombol `F` atau `f` saat mouse/viewport aktif (atau window aktif tanpa modifier `Ctrl`, `Alt`, `Meta`, `Shift`, dan `repeat`).
   - Objek yang dituju adalah `selectedEntityIds[0]` (atau entitas aktif pertama).
2. **Double-Click pada Entity di Hierarchy Panel:**
   - Melakukan double-click (`onDoubleClick`) pada baris entitas di `HierarchyPanel.tsx` otomatis memilih entitas dan langsung memicu aksi Focus.
3. **Menu Konteks Klik Kanan di Hierarchy Panel:**
   - Menambahkan opsi menu **"Focus Object (F)"** pada dropdown klik kanan entitas.
4. **Tombol Ikon / Tooltip di Viewport Toolbar (Opsional):**
   - Menambahkan tombol/indikator framing di toolbar viewport: `Focus (F)`.

### 3.2 Penentuan Bounding Box & Titik Pusat
Untuk menentukan posisi kamera dan jarak zoom yang tepat:
1. **Objek dengan Geometri (MeshRenderer / Model / EditableMesh / ParticleEmitter):**
   - Mengambil `THREE.Object3D` dari `SceneBridge.getObject(entityId)`.
   - Menghitung world bounding box menggunakan `const box = new THREE.Box3().setFromObject(object3D)`.
2. **Objek Kosong atau Non-Geometri (Empty Entity, Light, Camera, Audio, Trigger Collider):**
   - Jika `box.isEmpty()` atau dimensi ukurannya $0$:
   - Gunakan posisi dunia objek `object3D.getWorldPosition(center)` atau `Transform.position`.
   - Tetapkan bounding box default minimum berukuran $1 \times 1 \times 1$ m yang berpusat pada posisi tersebut.
3. **Pilihan Banyak Objek (Multi-Selection):**
   - Jika beberapa entity dipilih bersamaan (`selectedEntityIds.length > 1`), bounding box digabungkan (`box.union(...)`) sehingga kamera memuat seluruh objek yang dipilih sekaligus.

### 3.3 Kalkulasi Jarak Kamera Optimal (Framing Formula)
1. Hitung pusat bounding box:
   $$\vec{C} = \text{box.getCenter}()$$
2. Hitung dimensi bounding box:
   $$\vec{S} = \text{box.getSize}(), \quad D_{\max} = \max(S_x, S_y, S_z, 0.5)$$
3. **Mode 3D (Perspective Camera):**
   - Hitung jarak minimum berdasarkan sudut pandang vertikal kamera ($FOV_v$):
     $$\text{dist} = \frac{D_{\max} / 2}{\tan(FOV_v / 2)}$$
   - Berikan margin kenyamanan framing sebesar $1.5\times$ agar objek tidak menempel persis di pinggir layar:
     $$\text{distance} = \max(\text{dist} \times 1.5, 2.0)$$
   - Pertahankan sudut pandang kamera saat ini (*viewing angle vector*):
     $$\vec{V}_{\text{dir}} = \frac{\vec{P}_{\text{cam}} - \vec{C}_{\text{old}}}{\|\vec{P}_{\text{cam}} - \vec{C}_{\text{old}}\|}$$
     *(Jika panjang vektor mendekati nol, fallback ke arah isometrik standar $[1, 0.8, 1]$)*.
   - Posisi target kamera baru:
     $$\vec{P}_{\text{new}} = \vec{C} + \vec{V}_{\text{dir}} \times \text{distance}$$
   - Titik target `OrbitControls` baru:
     $$\vec{T}_{\text{new}} = \vec{C}$$
4. **Mode 2D (Orthographic Camera):**
   - Pusatkan posisi kamera: $P_x = C_x, P_y = C_y$.
   - Sesuaikan `frustumSize` agar sebanding dengan $D_{\max} \times 1.5$ dan perbarui matriks proyeksi.

### 3.4 Transisi Halus (Smooth Interpolation Animation)
Agar pergerakan kamera tidak mengagetkan (*jarring / snapping*):
- Kamera melakukan interpolasi halus (*cubic ease-out*) dari posisi lama ke posisi target selama durasi **$250\text{ ms}$**:
  $$\text{easeOutCubic}(t) = 1 - (1 - t)^3, \quad t \in [0, 1]$$
- Baik `camera.position` maupun `orbitControls.target` diinterpolasi bersamaan.
- Di akhir transisi, `orbitControls.target.copy(C)` dan `orbitControls.update()` dipanggil sehingga orbit langsung berpusat di objek.
- Jika pengguna menggerakkan mouse/kontrol saat animasi berjalan, animasi langsung dibatalkan (*user interruption safety*).

---

## 4. Rincian Teknis & Perubahan File

### 4.1 `editor/store/editorStore.ts`
Menambahkan state koordinasi untuk perintah fokus antar panel:
```typescript
export interface EditorState {
  // ...
  focusEntityNonce: number
  focusEntityId: string | null
  focusOnEntity: (id?: string | null) => void
}

// Implementation in createEditorStore:
focusEntityNonce: 0,
focusEntityId: null,
focusOnEntity: (id) => {
  const { selectedEntityIds } = get()
  const targetId = id || selectedEntityIds[0] || null
  if (targetId && !selectedEntityIds.includes(targetId)) {
    set({ selectedEntityIds: [targetId] })
  }
  set((s) => ({ focusEntityId: targetId, focusEntityNonce: s.focusEntityNonce + 1 }))
},
```

### 4.2 `editor/viewport/SceneViewport.tsx`
1. **Implementasi Fungsi `focusSelectedObject(entityId?: string)`:**
   - Menghitung `THREE.Box3` dari objek terpilih via `bridge.getObject(id)`.
   - Menghitung posisi kamera baru dan target `OrbitControls`.
   - Mengaktifkan state transisi kamera halus di loop render `animate()`.
2. **Penanganan Shortcut di `handleKeyDown`:**
   ```typescript
   // F: Focus on selected object (Object navigation mode)
   if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat) {
     if (!meshEdit) {
       e.preventDefault()
       focusSelectedObject()
       return
     }
   }
   ```
3. **Reaksi terhadap `focusEntityNonce`:**
   - Menambahkan `useEffect` yang mendengarkan perubahan `focusEntityNonce` dari `useEditorStore` untuk mengeksekusi `focusSelectedObject(focusEntityId)`.
4. **Tombol Toolbar Viewport:**
   - Menambahkan tombol `Focus (F)` di samping tombol transformasi `W`, `E`, `R`.

### 4.3 `editor/EditorLayout.tsx`
Menambahkan shortcut global `F` di event listener keyboard window:
```typescript
// F: Focus on selected entity
if (!useEditorStore.getState().meshEdit && !cmdOrCtrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !e.repeat) {
  const { selectedEntityIds, focusOnEntity } = useEditorStore.getState()
  if (selectedEntityIds.length > 0) {
    e.preventDefault()
    focusOnEntity(selectedEntityIds[0])
    return
  }
}
```

### 4.4 `editor/panels/HierarchyPanel.tsx`
1. **Double-Click pada Item Entitas:**
   ```tsx
   onDoubleClick={(e) => {
     e.stopPropagation()
     handleSelect(entity.id, e)
     useEditorStore.getState().focusOnEntity(entity.id)
   }}
   ```
2. **Context Menu:**
   Menambahkan opsi `Focus (F)` di menu klik kanan entitas.

---

## 5. Rencana Pengujian & Verifikasi

### 5.1 Unit Tests (`tests/editor/viewportFocus.test.ts`)
1. **Perhitungan Bounding Box:** Memverifikasi kalkulasi `Box3` untuk mesh tunggal, objek kosong, dan multi-seleksi menghasilkan pusat dan ukuran yang valid.
2. **Jarak Kamera Perspektif:** Memverifikasi formula jarak kamera proporsional dengan `maxDim` dan $FOV$.
3. **State `focusOnEntity` di Store:** Memverifikasi pemanggilan `focusOnEntity` mengubah `focusEntityId` dan menaikkan `focusEntityNonce`.

### 5.2 Manual Verification Checklist
1. Buka scene 3D di editor.
2. Pilih kubus atau model di tengah scene, geser kamera jauh ke belakang atau sudut acak.
3. Tekan **`F`** pada keyboard $\rightarrow$ kamera meluncur mulus dan memusatkan pandangan pada kubus.
4. Putar orbit mouse $\rightarrow$ kamera berputar tepat mengelilingi kubus tersebut.
5. Buat entitas baru di posisi jauh misal `[50, 10, -50]`. Di Hierarchy Panel, lakukan **double-click** pada entitas tersebut $\rightarrow$ kamera langsung meluncur ke objek di kejauhan.
6. Masuk ke **Edit Mesh Mode** (Tab) $\rightarrow$ tekan `F` pada edge/face $\rightarrow$ menjalankan fungsi *Fill/Bridge*, tidak menggerakkan kamera viewport.
7. Ketik huruf 'f' di input text Inspector / Console $\rightarrow$ teks terketik normal, kamera tidak bergerak.

---

## 6. Kriteria Selesai (Definition of Done)
1. Shortcut `F` berfungsi dengan mulus pada Scene Viewport untuk memfokuskan kamera pada objek terpilih.
2. Titik pivot `OrbitControls` terupdate ke pusat objek yang difokuskan.
3. Double click dan context menu di Hierarchy Panel dapat memicu focus ke objek di viewport.
4. Seluruh test suite vitest dan build electron berjalan sukses tanpa error.
