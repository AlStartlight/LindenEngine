// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
  _file_system_changed_callback(): void;
}

interface EmbindModule {
  remesh(_0: Float32Array, _1: Uint32Array, _2: number, _3: number): { ok: true; positions: Float32Array; indices: Uint32Array; cornerUvs?: Float32Array } | { ok: false; error: string };
  smooth(_0: Float32Array, _1: Uint32Array, _2: number): { ok: true; positions: Float32Array; indices: Uint32Array; cornerUvs?: Float32Array } | { ok: false; error: string };
  unwrapUV(_0: Float32Array, _1: Uint32Array, _2: number, _3: number): { ok: true; positions: Float32Array; indices: Uint32Array; cornerUvs?: Float32Array } | { ok: false; error: string };
  repair(_0: Float32Array, _1: Uint32Array, _2: number, _3: number): { ok: true; positions: Float32Array; indices: Uint32Array; cornerUvs?: Float32Array } | { ok: false; error: string };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
