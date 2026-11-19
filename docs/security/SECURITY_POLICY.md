# Kebijakan Keamanan & Panduan Pemindaian Kerentanan (LindenEngine)

Dokumen ini mendefinisikan prosedur pelaporan kerentanan, mekanisme audit otomatis, serta standar keamanan yang harus dipatuhi oleh seluruh kontributor LindenEngine.

---

## 1. Pelaporan Kerentanan Keamanan (Responsible Disclosure)

Jika Anda menemukan celah keamanan di LindenEngine (misalnya sandbox escape, RCE, Electron IPC bypass, atau path traversal):

- **JANGAN** membuat issue publik di GitHub.
- Laporkan secara langsung melalui saluran keamanan privat atau GitHub Security Advisories tab.
- Berikan rincian:
  1. Versi LindenEngine yang terdampak (dan OS: macOS, Windows, Linux).
  2. Proof-of-concept (PoC) atau langkah reproduksi minimal.
  3. Estimasi dampak dan vektor eksploitasi.

---

## 2. Praktik Pengamanan Kode (Code Security Guidelines)

### 2.1 Keamanan Electron

1. **Context Isolation & Node Integration:**
   - Seluruh jendela peramban (`BrowserWindow`) dan webview wajib mengatur:
     ```ts
     webPreferences: {
       contextIsolation: true,
       nodeIntegration: false,
       sandbox: true,
     }
     ```
   - Komunikasi antara renderer dan proses utama hanya boleh dilakukan melalui preload script dengan `contextBridge.exposeInMainWorld`.

2. **IPC Handler Validation:**
   - Semua channel `ipcMain.handle` wajib memvalidasi input parameter sebelum diproses.
   - Hindari menerima path absolut langsung dari renderer tanpa normalisasi dan pengecekan boundary terhadap folder project:
     ```ts
     const safePath = path.resolve(projectRoot, userProvidedRelativePath);
     if (!safePath.startsWith(projectRoot)) {
       throw new Error('Access denied: Path traversal detected');
     }
     ```

3. **Subprocess Execution:**
   - Jangan gunakan `child_process.exec()` dengan string concatenations.
   - Gunakan `child_process.spawn()` dengan array argumen dan `shell: false`.
   - Batasi `env` hanya pada variabel yang benar-benar dibutuhkan (`PATH`, `TMP`, dsb.), jangan teruskan semua variabel lingkungan host secara membabi-buta.

---

## 3. Tool Pemindaian Kerentanan (Local Security Scanners)

Pengembang dapat menjalankan audit keamanan di repositori lokal:

1. **Audit Dependensi NPM:**
   ```bash
   npm audit --audit-level=high
   ```

2. **Pengecekan Lisensi (Copyleft Guard):**
   ```bash
   node scripts/check-licenses.mjs
   ```

3. **Pemindaian Agent Skills (SkillSpector):**
   ```bash
   node scripts/check-skills.mjs
   ```

4. **Audit Terpadu:**
   ```bash
   node scripts/security-scan.mjs
   ```
