import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

export interface ZipFileInput {
  path: string
  content: Buffer | string
}

function crc32(buf: Buffer): number {
  let crc = ~0
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (~crc) >>> 0
}

/**
 * Creates a standard PKZIP archive buffer in memory without external dependencies.
 */
export function createZipArchive(files: ZipFileInput[]): Buffer {
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const data = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf-8')
    const compressed = zlib.deflateRawSync(data)
    const nameBuf = Buffer.from(file.path.replace(/\\/g, '/'))
    const crc = crc32(data)

    // Local file header (30 bytes)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4) // Version needed
    lh.writeUInt16LE(0, 6) // Flags
    lh.writeUInt16LE(8, 8) // Compression method: Deflate
    lh.writeUInt16LE(0, 10) // Mod time
    lh.writeUInt16LE(0, 12) // Mod date
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(compressed.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28) // Extra field length

    localChunks.push(lh, nameBuf, compressed)

    // Central directory header (46 bytes)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4) // Made by
    cd.writeUInt16LE(20, 6) // Version needed
    cd.writeUInt16LE(0, 8) // Flags
    cd.writeUInt16LE(8, 10) // Deflate
    cd.writeUInt16LE(0, 12) // Mod time
    cd.writeUInt16LE(0, 14) // Mod date
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(compressed.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30) // Extra field length
    cd.writeUInt16LE(0, 32) // Comment length
    cd.writeUInt16LE(0, 34) // Disk start
    cd.writeUInt16LE(0, 36) // Internal attr
    cd.writeUInt32LE(0, 38) // External attr
    cd.writeUInt32LE(offset, 42) // Relative offset of local header

    centralChunks.push(cd, nameBuf)
    offset += lh.length + nameBuf.length + compressed.length
  }

  const centralSize = centralChunks.reduce((acc, c) => acc + c.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // Disk number
  eocd.writeUInt16LE(0, 6) // Disk start
  eocd.writeUInt16LE(files.length, 8) // Central dir entries on this disk
  eocd.writeUInt16LE(files.length, 10) // Total entries
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // Comment length

  return Buffer.concat([...localChunks, ...centralChunks, eocd])
}

/**
 * Creates a zip file from all files in a directory.
 */
export async function zipDirectory(sourceDir: string, zipFilePath: string): Promise<void> {
  const filesToZip: ZipFileInput[] = []

  function scan(dir: string, base: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name)
      const relPath = base ? `${base}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        scan(fullPath, relPath)
      } else if (ent.isFile()) {
        // Skip the zip file itself if located in the same directory
        if (path.resolve(fullPath) === path.resolve(zipFilePath)) continue
        filesToZip.push({
          path: relPath,
          content: fs.readFileSync(fullPath),
        })
      }
    }
  }

  scan(sourceDir, '')
  const buffer = createZipArchive(filesToZip)
  fs.mkdirSync(path.dirname(zipFilePath), { recursive: true })
  fs.writeFileSync(zipFilePath, buffer)
}
