/**
 * linden-asset://project/<path> serves files of the open project to the editor viewport (textures,
 * HDR environments, glTF models), so the editor loads assets the same way the player does.
 */
export const ASSET_SCHEME = 'linden-asset'
export const ASSET_HOST = 'project'

export function projectAssetUrl(rel: string): string {
  return `${ASSET_SCHEME}://${ASSET_HOST}/${rel.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`
}

export interface AssetEntry {
  path: string
  kind: 'model' | 'environment' | 'texture' | 'audio' | 'other'
  size: number
}

export function assetKind(path: string): AssetEntry['kind'] {
  if (/\.(glb|gltf|obj)$/i.test(path)) return 'model'
  if (/\.(hdr|exr)$/i.test(path)) return 'environment'
  if (/\.(png|jpe?g|webp|svg|ktx2|avif)$/i.test(path)) return 'texture'
  if (/\.(mp3|ogg|wav|m4a)$/i.test(path)) return 'audio'
  return 'other'
}
