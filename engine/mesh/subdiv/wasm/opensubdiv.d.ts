// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

interface EmbindModule {
  subdivide(_0: Float32Array, _1: Uint32Array, _2: Uint32Array, _3: Float32Array, _4: number, _5: number): { ok: true; positions: Float32Array; faceSizes: Uint32Array; faceVertices: Uint32Array; cornerUvs?: Float32Array } | { ok: false; error: string };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
