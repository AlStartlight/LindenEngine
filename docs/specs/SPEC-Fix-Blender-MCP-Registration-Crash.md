# SPEC: Fix Crash Build Electron pada Pendaftaran Blender MCP (TS2322)

**Tanggal:** 20 November 2026  
**Status:** Ready for Implementation / Fix  
**Target:** `electron/agent/AgentHost.ts`, `npm run electron-dev`, `build:electron`  
**Terkait:** [`SPEC-Blender-MCP-Image-To-3D.md`](./SPEC-Blender-MCP-Image-To-3D.md), [`SPEC-Blender-3D-Agent.md`](./SPEC-Blender-3D-Agent.md)

---

## 1. Ringkasan Masalah

Saat menjalankan `npm run electron-dev`, proses watch Electron (`build:electron`) langsung mengalami crash saat tahap typecheck:

```
[1] > linden-engine@2.0.0 build:electron
[1] > tsc -p tsconfig.electron.json --noEmit && node scripts/build-electron.mjs
[1] 
[1] electron/agent/AgentHost.ts(401,79): error TS2322: Type '{ type: "stdio"; command: string; args: string[]; timeout: { execution: number; }; }' is not assignable to type '{ readonly type: "local"; readonly command: readonly string[]; readonly cwd?: string | undefined; readonly environment?: { readonly [x: string]: string; } | undefined; readonly disabled?: boolean | undefined; readonly codemode?: boolean | undefined; readonly timeout?: { ...; } | undefined; readonly protocol?: "auto"...'.
[1]   Type '{ type: "stdio"; command: string; args: string[]; timeout: { execution: number; }; }' is not assignable to type '{ readonly type: "local"; readonly command: readonly string[]; readonly cwd?: string | undefined; readonly environment?: { readonly [x: string]: string; } | undefined; readonly disabled?: boolean | undefined; readonly codemode?: boolean | undefined; readonly timeout?: { ...; } | undefined; readonly protocol?: "auto"...'.
[1]     Types of property 'type' are incompatible.
[1]       Type '"stdio"' is not assignable to type '"local"'.
[1] [nodemon] app crashed - waiting for file changes before starting...
```

Error ini memblokir seluruh workflow development Electron karena `nodemon` menghentikan proses sebelum Electron sempat diluncurkan.

---

## 2. Gejala & Lingkungan Eksekusi

### 2.1 Perintah Pemicu
```bash
npm run electron-dev
# atau secara langsung:
npx tsc -p tsconfig.electron.json --noEmit
```

### 2.2 Dampak
- Build `build:electron` gagal pada tahap `tsc -p tsconfig.electron.json --noEmit` dengan exit code 2.
- Aplikasi Electron tidak dapat dijalankan (`app crashed - waiting for file changes before starting...`).

---

## 3. Akar Masalah (Root Cause Analysis)

### 3.1 Lokasi Kode
Di `electron/agent/AgentHost.ts` baris 387–404:

```typescript
// electron/agent/AgentHost.ts
private async registerBlenderMcp(): Promise<void> {
  if (!this.client) return
  const status = getBlenderStatus()
  if (!status.found || !status.path) {
    await this.client.mcp.remove({ server: 'blender', location: this.location() } as any).catch(() => {})
    return
  }
  const config = {
    type: 'stdio' as const,
    command: 'node',
    args: [resolveAppResource('blender-bridge/mcp_proxy.js', 'blender-bridge/mcp_proxy.js'), status.path],
    timeout: { execution: MCP_EXECUTION_TIMEOUT_MS },
  }
  await this.client.mcp.remove({ server: 'blender', location: this.location() } as any).catch(() => {})
  await this.client.mcp.add({ server: 'blender', location: this.location(), config }).catch((e) => {
    console.warn('[Agent] Peringatan saat mendaftarkan server Blender MCP:', e?.message ?? e)
  })
}
```

### 3.2 Analisis Tipe `@opencode/client`
Berdasarkan deklarasi tipe resmi di `node_modules/@opencode/client/dist/promise/generated/types.d.ts` (tipe `McpAddInput` dan varian `config`):

```typescript
export type McpAddInput = {
    readonly server: string;
    readonly location?: { ... };
    readonly config: {
        readonly type: "local";
        readonly command: ReadonlyArray<string>;
        readonly cwd?: string;
        readonly environment?: { readonly [x: string]: string };
        readonly disabled?: boolean;
        readonly codemode?: boolean;
        readonly timeout?: {
            readonly startup?: number;
            readonly catalog?: number;
            readonly execution?: number;
        };
        readonly protocol?: "legacy" | "auto" | "2026-07-28";
    } | {
        readonly type: "remote";
        readonly url: string;
        readonly headers?: { readonly [x: string]: string };
        ...
    };
};
```

Terdapat 2 inkompatibilitas struktural pada objek `config`:
1. **Nilai `type` salah**: Menggunakan `'stdio'`, sedangkan skema `@opencode/client` mendefinisikan server lokal berbasis proses stdio dengan diskriminator `type: 'local'`.
2. **Struktur argumen perintah salah**: Skema OpenCode tidak memiliki field `args: string[]`. Sebagai gantinya, executable dan seluruh argumennya digabung ke dalam satu array `command: ReadonlyArray<string>`, contoh: `['node', proxyScriptPath, status.path]`.

---

## 4. Rencana Solusi (Implementation Specification)

### 4.1 Perubahan Kode di `electron/agent/AgentHost.ts`

Ubah konfigurasi `config` di dalam fungsi `registerBlenderMcp()`:

#### Sebelum:
```typescript
const config = {
  type: 'stdio' as const,
  command: 'node',
  args: [resolveAppResource('blender-bridge/mcp_proxy.js', 'blender-bridge/mcp_proxy.js'), status.path],
  timeout: { execution: MCP_EXECUTION_TIMEOUT_MS },
}
```

#### Sesudah:
```typescript
const config = {
  type: 'local' as const,
  command: [
    'node',
    resolveAppResource('blender-bridge/mcp_proxy.js', 'blender-bridge/mcp_proxy.js'),
    status.path,
  ],
  timeout: { execution: MCP_EXECUTION_TIMEOUT_MS },
}
```

### 4.2 Verifikasi Kompatibilitas Runtime
- Script `blender-bridge/mcp_proxy.js` membaca executable Blender dari `process.argv[2]`.
- Ketika OpenCode mengeksekusi server `type: 'local'`, ia menjalankan `command[0]` dengan argumen `command.slice(1)` melalui stdio:
  - `command[0]` = `'node'`
  - `command[1]` = path ke `blender-bridge/mcp_proxy.js`
  - `command[2]` = `status.path` (path binary Blender)
- Dengan konfigurasi ini, `process.argv[2]` di `mcp_proxy.js` akan menerima path binary Blender secara tepat dan fallback daemon maupun koneksi socket port `9876` tetap berjalan sesuai desain.

---

## 5. Rencana Pengujian & Verifikasi

### 5.1 Test Step 1: Type Checking Kompilasi Electron
Menjalankan kompilasi TypeScript untuk Electron:
```bash
npx tsc -p tsconfig.electron.json --noEmit
```
**Ekspektasi:** Exit code 0, tidak ada error TS2322.

### 5.2 Test Step 2: Build Electron
Menjalankan script build electron:
```bash
npm run build:electron
```
**Ekspektasi:** `tsc` berhasil tanpa error dan script `scripts/build-electron.mjs` mengompilasi file ke `dist-electron/`.

### 5.3 Test Step 3: Validasi Suite Test Terkait
Menjalankan test unit Blender bridge & MCP:
```bash
npm test tests/bridge/blenderMcp.test.ts
```
**Ekspektasi:** Seluruh test suite lulus (PASS).

### 5.4 Test Step 4: Smoke Test Startup
Menjalankan aplikasi dalam mode dev:
```bash
npm run electron-dev
```
**Ekspektasi:** `nodemon` berhasil membangun Electron, tidak crash, dan jendela editor LindenEngine terbuka normal.

---

## 6. Daftar Checklist Penyelesaian

- [x] Update `electron/agent/AgentHost.ts` (ubah `type: 'stdio'` menjadi `type: 'local'`, gabungkan argumen ke dalam array `command`).
- [x] Fix `nodemon` crash `TypeError: minimatch is not a function` akibat override `minimatch@11` (skrip `scripts/patch-minimatch.mjs` & penyesuaian `overrides.nodemon.minimatch`).
- [x] Validasi `npx tsc -p tsconfig.electron.json --noEmit` lolos bersih (exit code 0).
- [x] Validasi `npm run build:electron` berhasil (exit code 0).
- [x] Validasi `npm test tests/bridge/blenderMcp.test.ts` berhasil (3 tests PASS).
- [x] Konfirmasi `predev` dan build siap dijalankan via `npm run electron-dev`.
