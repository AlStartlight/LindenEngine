// Merges report/batch-*.json and proves global uniqueness from report/fingerprints-*.txt
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES } from './manifest.mjs'

const report = join(dirname(fileURLToPath(import.meta.url)), '..', 'report')
const batches = readdirSync(report).filter((f) => /^batch-.+\.json$/.test(f) && f !== 'batch-smoke.json').map((f) => JSON.parse(readFileSync(join(report, f), 'utf8')))

const seen = new Set()
let fingerprints = 0
let duplicates = 0
for (const f of readdirSync(report).filter((f) => /^fingerprints-.+\.txt$/.test(f) && f !== 'fingerprints-smoke.txt')) {
  for (const fp of readFileSync(join(report, f), 'utf8').split('\n')) {
    if (!fp) continue
    fingerprints++
    if (seen.has(fp)) duplicates++
    else seen.add(fp)
  }
}

const rows = []
const totals = { passed: 0, failed: 0, skipped: 0, expected: 0 }
for (const c of CATEGORIES) {
  const b = batches.find((x) => x.batch === c.dir)
  const r = b?.byCategory?.[c.title] ?? { passed: 0, failed: 0, skipped: 0 }
  totals.passed += r.passed
  totals.failed += r.failed
  totals.skipped += r.skipped
  totals.expected += c.count
  const ran = r.passed + r.failed + r.skipped
  rows.push(`| ${c.title} | \`TC-${c.prefix}\` | ${c.count.toLocaleString('id-ID')} | ${ran.toLocaleString('id-ID')} | ${r.passed.toLocaleString('id-ID')} | ${r.failed.toLocaleString('id-ID')} | ${b ? Math.round(b.durationMs / 1000) + ' s' : '—'} |`)
}

const failureSections = []
for (const b of batches) {
  for (const [cat, list] of Object.entries(b.failures || {})) {
    failureSections.push(`### ${cat}\n\n` + list.map((f) => `- \`${f.title}\`\n  - ${f.error.replace(/\|/g, '\\|')}`).join('\n'))
  }
}

const md = `# Hasil 680.000 Test Case

Dibuat ${new Date().toISOString()} oleh \`tools/merge-report.mjs\`.

| Total diharapkan | Dijalankan | Lulus | Gagal | Skip | Judul unik | Duplikat |
| --- | --- | --- | --- | --- | --- | --- |
| ${totals.expected.toLocaleString('id-ID')} | ${(totals.passed + totals.failed + totals.skipped).toLocaleString('id-ID')} | ${totals.passed.toLocaleString('id-ID')} | ${totals.failed.toLocaleString('id-ID')} | ${totals.skipped.toLocaleString('id-ID')} | ${seen.size.toLocaleString('id-ID')} dari ${fingerprints.toLocaleString('id-ID')} | ${duplicates} |

| Kategori | ID | Diharapkan | Dijalankan | Lulus | Gagal | Durasi |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## Contoh kegagalan (maks. 25 per kategori)

${failureSections.join('\n\n') || 'Tidak ada.'}
`
writeFileSync(join(report, 'REPORT.md'), md)
console.log(`merged: ${totals.passed + totals.failed + totals.skipped} run, ${totals.passed} passed, ${totals.failed} failed, ${seen.size}/${fingerprints} unique, ${duplicates} duplicates`)
