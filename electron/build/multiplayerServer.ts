import fs from 'node:fs'
import path from 'node:path'
import type { MultiplayerConfig } from '../../shared/net/config'

/**
 * Web builds of multiplayer projects get server/: the bundled room + static server
 * (dist-electron/linden-server.mjs, built by scripts/build-electron.mjs), a README and a Dockerfile.
 */

export function findServerBundle(): string | null {
  const candidates = [path.join(__dirname, 'linden-server.mjs'), path.join(process.cwd(), 'dist-electron', 'linden-server.mjs')]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

export function writeMultiplayerServer(outDir: string, cfg: MultiplayerConfig, appName: string, bundle = findServerBundle()): { ok: true } | { ok: false; reason: string } {
  if (!bundle) return { ok: false, reason: 'Server multiplayer belum dibangun (jalankan npm run build:electron); folder server/ tidak dibuat' }
  const dir = path.join(outDir, 'server')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(bundle, path.join(dir, 'linden-server.mjs'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'linden-game-server', private: true, type: 'module', scripts: { start: 'node linden-server.mjs' }, engines: { node: '>=18' } }, null, 2))
  fs.writeFileSync(
    path.join(dir, 'Dockerfile'),
    `# ${appName}: game + multiplayer server in one container
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8080 LINDEN_MAX_PLAYERS=${cfg.maxPlayers}
EXPOSE 8080
CMD ["node", "server/linden-server.mjs", "--static", "/app"]
`
  )
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    `# Server multiplayer ${appName}

Folder ini berisi server untuk game multiplayer. Satu proses Node menyajikan file game (folder build di atasnya) sekaligus server room WebSocket di \`/net\`.

## Menjalankan

Butuh Node.js 18+, tanpa \`npm install\`.

\`\`\`
node server/linden-server.mjs --port 8080
\`\`\`

Buka \`http://localhost:8080\` di dua browser untuk mencoba dua pemain. Room bisa dipilih dengan \`?room=nama\`, nama pemain dengan \`?name=Asep\`.

| Opsi | Env | Default |
|---|---|---|
| \`--port\` | \`PORT\` | 8080 |
| \`--host\` | \`HOST\` | 0.0.0.0 |
| \`--max-players\` | \`LINDEN_MAX_PLAYERS\` | ${cfg.maxPlayers} |
| \`--origins https://game.com\` | \`LINDEN_ORIGINS\` | semua origin |
| \`--static <folder>\` |  | folder build (\`..\`) |
| \`--no-static\` |  | hanya WebSocket |

## Produksi (HTTPS/WSS)

Halaman \`https://\` hanya boleh membuka \`wss://\`. Pasang reverse proxy dengan TLS di depan server, misalnya Caddy:

\`\`\`
game.contoh.com {
  reverse_proxy localhost:8080
}
\`\`\`

Kalau game di-hosting terpisah (CDN), isi **Server produksi** di Project Settings > Multiplayer dengan \`wss://game.contoh.com/net\`, lalu jalankan server dengan \`--no-static --origins https://cdn.contoh.com\`.

## Docker

\`\`\`
docker build -f server/Dockerfile -t ${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'linden-game'} .
docker run -p 8080:8080 ${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'linden-game'}
\`\`\`

## Batasan (v1)

Setiap pemain menyimulasikan entity miliknya sendiri, dan server hanya memeriksa kepemilikan, ukuran pesan, dan laju pesan. Pemain yang memodifikasi klien bisa memalsukan posisi miliknya. Server tidak menyimpan apa pun ke disk: state room hilang saat room kosong atau server dimulai ulang.
`
  )
  return { ok: true }
}
