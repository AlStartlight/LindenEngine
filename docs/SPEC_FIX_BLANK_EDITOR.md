# Spec: Fix Editor Desktop Blank (WebGL Context Lost)

23 Okt 2026 · Status: Draft · Prioritas: P0 (editor tidak bisa dipakai)

Editor desktop tampil kosong: menu, toolbar, Hierarchy, Inspector, dan viewport tidak muncul. Penyebabnya adalah `renderer.forceContextLoss()` di cleanup `SceneViewport`. Di development, `React.StrictMode` menjalankan effect dua kali pada `<canvas>` yang sama. Mount kedua lalu membuat `WebGLRenderer` di atas konteks yang sudah dimatikan dan crash. Karena tidak ada error boundary, React meng-unmount **seluruh** tree, jadi seluruh layar blank.

---

## 1. Gejala

- `npm run electron-dev` → jendela terbuka, tetapi isinya hanya background gelap tanpa UI.
- Console DevTools:

```
THREE.WebGLRenderer: Context Lost.
Uncaught TypeError: Cannot read properties of null (reading 'precision')
    at getMaxPrecision (three.module.js:15666)
    at new WebGLCapabilities (three.module.js:15695)
    at new WebGLRenderer (three.module.js:28522)
    at SceneViewport.tsx:136
    at invokePassiveEffectMountInDEV (react-dom.development.js:25193)
The above error occurred in the <SceneViewport> component ...
Consider adding an error boundary to your tree ...
```

- Error yang sama berulang setiap kali file disimpan (HMR / React Refresh menjalankan ulang effect).
- Peringatan `Electron Security Warning (Insecure Content-Security-Policy)` di log **tidak** terkait. Itu hanya muncul di development dan tidak membuat halaman blank.

## 2. Akar masalah

### 2.1 Rantai kejadian

1. `src/App.tsx` membungkus aplikasi dengan `<React.StrictMode>`. Di development, React sengaja menjalankan setiap effect **mount → cleanup → mount** untuk mendeteksi efek samping.
2. **Mount 1** (`editor/viewport/SceneViewport.tsx:136`): `new THREE.WebGLRenderer({ canvas })` mengambil konteks WebGL dari elemen `<canvas ref={canvasRef}>`.
3. **Cleanup** (`SceneViewport.tsx:346-347`): `renderer.dispose()` lalu `renderer.forceContextLoss()`. Konteks WebGL milik canvas itu sekarang berstatus *lost*.
4. **Mount 2**: elemen `<canvas>` yang sama dipakai lagi (React tidak membuat elemen DOM baru saat double-invoke). `canvas.getContext('webgl2')` mengembalikan konteks yang sama, yang sudah *lost*.
5. Pada konteks yang *lost*, `gl.getShaderPrecisionFormat()` mengembalikan `null`. Three.js membaca `null.precision` di `getMaxPrecision` → `TypeError`.
6. Error dilempar dari dalam effect, dan tidak ada error boundary di atas `SceneViewport`. React 18 lalu meng-unmount seluruh root, termasuk `Toolbar`, `HierarchyPanel`, dan Inspector. Hasilnya layar blank.

### 2.2 Asal perubahan

`forceContextLoss()` ditambahkan di cleanup mengikuti rekomendasi PRD New Scene (mencegah konteks WebGL menumpuk saat remount lewat `key`). Rekomendasi itu benar untuk remount lewat `key` (elemen canvas baru), tetapi salah untuk StrictMode dan React Refresh, yang memakai ulang elemen canvas yang sama. PRD New Scene perlu dikoreksi bersamaan dengan fix ini (§6).

### 2.3 Kenapa production tidak selalu terdampak

StrictMode double-invoke hanya terjadi di development. Namun bug yang sama tetap bisa muncul di production jika effect init berjalan ulang pada canvas yang sama. Effect itu punya dependency `[includeSampleObjects, initialScene, updateHierarchy]`, jadi setiap perubahan identitas salah satunya akan memicu crash yang sama. Karena itu fix-nya tidak boleh hanya "matikan StrictMode".

## 3. Tujuan dan non-tujuan

**Tujuan**

1. Editor tampil normal di `npm run electron-dev`, `npm run dev`, dan build production.
2. Effect init viewport aman dijalankan berapa kali pun (StrictMode, HMR, perubahan prop).
3. Error di viewport tidak lagi membuat seluruh editor blank. Panel lain tetap bisa dipakai, dan viewport menampilkan pesan error + tombol muat ulang.
4. Konteks WebGL tetap dilepas saat viewport di-unmount (tujuan awal `forceContextLoss` tetap tercapai).

**Non-tujuan**

- Mematikan `React.StrictMode`. Itu hanya menyembunyikan bug dari §2.3.
- Memperbaiki peringatan CSP Electron (tiket keamanan terpisah).
- Migrasi ke WebGPU.

## 4. Desain perbaikan

### 4.1 [P0] Canvas dibuat oleh effect, bukan oleh JSX

Setiap kali effect init berjalan, buat elemen `<canvas>` baru, dan hapus di cleanup. Dengan begitu `forceContextLoss()` hanya mematikan konteks milik canvas yang memang dibuang.

`editor/viewport/SceneViewport.tsx`:

```tsx
// Initialize Three.js scene
useEffect(() => {
  const container = containerRef.current
  if (!container) return

  // Canvas baru per mount: konteks WebGL yang di-forceContextLoss() di cleanup
  // tidak pernah dipakai ulang oleh mount berikutnya (StrictMode / HMR).
  const canvas = document.createElement('canvas')
  canvas.className = 'block w-full h-full'
  container.prepend(canvas)
  canvasRef.current = canvas

  // ... sisa inisialisasi tetap sama (scene, camera, renderer, controls) ...

  return () => {
    // ... cleanup yang sudah ada ...
    renderer.dispose()
    renderer.forceContextLoss()
    canvas.remove()
    canvasRef.current = null
  }
}, [includeSampleObjects, initialScene, updateHierarchy])
```

Dan di JSX, hapus elemen canvas statis:

```diff
 <div ref={containerRef} className="w-full h-full relative bg-[#1a1a2e]">
-  <canvas ref={canvasRef} className="w-full h-full" />
```

Catatan:

- `container.prepend` menaruh canvas sebelum overlay toolbar viewport (yang `absolute`), jadi urutan tumpukan tidak berubah.
- `canvasRef` sekarang bertipe `useRef<HTMLCanvasElement | null>(null)` dan hanya diisi oleh effect. Saat ini ia hanya dipakai di effect init, jadi tidak ada pemakai lain yang terdampak.

**Hotfix alternatif (satu baris)** jika butuh unblock segera: hapus `renderer.forceContextLoss()` dari cleanup. StrictMode lalu memakai ulang konteks yang masih hidup dan editor tampil lagi. Kekurangannya: konteks lama tidak dilepas secara eksplisit saat New Scene / Open Scene. §4.1 tetap harus dikerjakan sesudahnya.

### 4.2 [P0] Error boundary di sekitar viewport

Supaya error apa pun di viewport tidak mengosongkan seluruh editor.

File baru `editor/ui/ErrorBoundary.tsx`:

```tsx
import React from 'react'

interface ErrorBoundaryProps {
  fallback: (error: Error, reset: () => void) => React.ReactNode
  onError?: (error: Error) => void
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset)
    return this.props.children
  }
}
```

`editor/EditorLayout.tsx`, di sekitar `<SceneViewport>`:

```tsx
<ErrorBoundary
  onError={(e) => addConsoleMessage('error', `Viewport error: ${e.message}`)}
  fallback={(error, reset) => (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-sm text-gray-300">
      <div>Viewport gagal dimuat: {error.message}</div>
      <button
        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500"
        onClick={() => { setSceneKey(k => k + 1); reset() }}
      >
        Muat ulang viewport
      </button>
    </div>
  )}
>
  <SceneViewport key={sceneKey} ... />
</ErrorBoundary>
```

Pertimbangkan juga boundary yang sama di sekitar `BlueprintEditor`, `MaterialEditor`, `AnimatorEditor`, dan `SequencerEditor` (P1). Mereka juga berisi canvas/graph yang bisa melempar error.

### 4.3 [P1] Tangani konteks WebGL yang hilang saat runtime

GPU bisa me-reset konteks kapan saja: driver crash, laptop sleep, atau terlalu banyak konteks. Saat ini kejadian itu membuat viewport membeku tanpa pesan.

Di effect init, setelah canvas dibuat:

```ts
const handleContextLost = (e: Event) => {
  e.preventDefault() // izinkan browser memulihkan konteks
  cancelAnimationFrame(animationFrameRef.current)
  onContextLost?.()
}
canvas.addEventListener('webglcontextlost', handleContextLost)
// cleanup: canvas.removeEventListener('webglcontextlost', handleContextLost)
```

`EditorLayout` menangani `onContextLost` dengan menaikkan `sceneKey` (remount viewport) dan menulis log `warn` ke Console. Setelah Save Scene ada, isi scene perlu disimpan dulu ke memori sebelum remount agar tidak hilang.

Catatan: event ini juga terpicu oleh `forceContextLoss()` di cleanup kita sendiri. Listener harus dilepas **sebelum** `forceContextLoss()` dipanggil.

### 4.4 [P1] Stabilkan dependency effect init

Effect init membangun ulang seluruh scene setiap kali `includeSampleObjects`, `initialScene`, atau `updateHierarchy` berubah identitas. Setelah §4.1 ini tidak crash lagi, tetapi tetap membuang scene pengguna tanpa sengaja.

- Remount viewport memang sudah diatur lewat `key={sceneKey}`. Jadi effect init cukup berjalan sekali per mount: simpan `includeSampleObjects` dan `initialScene` di ref, dan kosongkan array dependency.
- `updateHierarchy` sudah `useCallback(..., [])` dan membaca callback lewat ref. Pertahankan itu.

## 5. Perubahan per file

| File | Perubahan | Prioritas |
| --- | --- | --- |
| `editor/viewport/SceneViewport.tsx` | Canvas dibuat/dihapus oleh effect init; `<canvas>` statis dihapus dari JSX. | P0 |
| `editor/ui/ErrorBoundary.tsx` (baru) | Komponen error boundary generik. | P0 |
| `editor/EditorLayout.tsx` | Bungkus `SceneViewport` dengan `ErrorBoundary`; fallback + tombol muat ulang; log ke Console. | P0 |
| `editor/viewport/SceneViewport.tsx` | Listener `webglcontextlost` + prop `onContextLost`. | P1 |
| `editor/viewport/SceneViewport.tsx` | Dependency effect init distabilkan (§4.4). | P1 |
| `editor/EditorLayout.tsx` | `ErrorBoundary` untuk panel editor lain. | P1 |
| `docs/Spec.PRD: File → New Scene (Ctrl+N)/…md` | Koreksi rekomendasi `forceContextLoss()` (lihat §6). | P0 |

## 6. Koreksi untuk PRD New Scene

Di bagian Desain teknis dan Edge case, ganti:

> Tambah `renderer.forceContextLoss()` di cleanup agar remount tidak menumpuk konteks WebGL.

menjadi:

> Canvas dibuat oleh effect init dan dihapus di cleanup, setelah `renderer.dispose()` dan `renderer.forceContextLoss()`. Jangan pernah memanggil `forceContextLoss()` pada canvas yang dirender lewat JSX: StrictMode dan React Refresh memakai ulang elemen itu, dan mount berikutnya crash dengan `Cannot read properties of null (reading 'precision')`.

## 7. Kriteria penerimaan

- [ ] `npm run electron-dev`: editor tampil lengkap (menu, toolbar, Hierarchy, viewport dengan objek, Inspector, Console). Tidak ada `TypeError ... 'precision'` di DevTools.
- [ ] `npm run dev` di Chrome: sama seperti di atas.
- [ ] Edit dan simpan `SceneViewport.tsx` 5 kali saat app berjalan (HMR): viewport tetap tampil setiap kali, tanpa error.
- [ ] File → New Scene 20 kali berturut-turut: tidak ada warning `Too many active WebGL contexts`. Di DevTools → Elements hanya ada satu `<canvas>` di dalam viewport.
- [ ] Pindah tab Scene → Blueprint → Scene: viewport muncul lagi tanpa error.
- [ ] Simulasi error (sementara tambahkan `throw new Error('test')` di effect init): hanya area viewport yang menampilkan fallback; menu, Hierarchy, Inspector, dan Console tetap berfungsi; Console berisi `Viewport error: test`; tombol "Muat ulang viewport" memulihkan viewport setelah `throw` dihapus.
- [ ] (P1) Simulasi context lost lewat DevTools: `document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()` → viewport remount otomatis dan Console mencatat peringatan.
- [ ] `npm run type-check` dan `npm run build` lolos.

## 8. Risiko

| Risiko | Mitigasi |
| --- | --- |
| Overlay viewport (toolbar, stats) tertutup canvas karena urutan DOM berubah | `container.prepend(canvas)` menaruh canvas paling awal; overlay memakai `absolute` dan dirender setelahnya. Diverifikasi di kriteria penerimaan pertama. |
| Ukuran canvas 0×0 saat dibuat karena container belum ber-layout | `ResizeObserver` yang sudah ada memanggil `renderer.setSize` saat ukuran container berubah. |
| Error boundary menelan error tanpa ada yang tahu | `componentDidCatch` menulis ke Console panel; error tetap muncul di DevTools. |
