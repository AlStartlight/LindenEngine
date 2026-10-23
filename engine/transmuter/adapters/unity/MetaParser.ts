/**
 * Unity .meta file Parser
 */

export interface UnityMetaInfo {
  guid: string
  folderAsset?: boolean
  pixelsPerUnit?: number
}

export class MetaParser {
  static parse(metaContent: string): UnityMetaInfo {
    const guidMatch = metaContent.match(/guid:\s*([a-fA-F0-9]{32})/)
    const guid = guidMatch ? guidMatch[1] : ''

    const isFolder = /folderAsset:\s*yes/i.test(metaContent)

    const ppuMatch = metaContent.match(/spritePixelsToUnits:\s*([0-9.]+)/)
    const pixelsPerUnit = ppuMatch ? parseFloat(ppuMatch[1]) : 100

    return {
      guid,
      folderAsset: isFolder,
      pixelsPerUnit,
    }
  }
}
