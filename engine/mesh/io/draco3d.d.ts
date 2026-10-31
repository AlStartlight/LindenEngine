// draco3d ships no typings; the API we use is described in ./draco.ts at the binding boundary
declare module 'draco3d' {
  const draco3d: unknown
  export default draco3d
}
