#!/usr/bin/env bash
# Builds the native geometry modules (OpenSubdiv, Geogram) to WebAssembly with one pinned Emscripten
# toolchain. Everything it downloads lives under native/ (.emsdk, .venv, .cache, build); outputs are
# committed to engine/mesh/{subdiv,uv}/wasm so the app build never needs Emscripten.
#
#   npm run build:native            # all stages
#   native/build.sh toolchain       # only install emsdk + cmake/ninja
#   native/build.sh sources|opensubdiv|geogram|bindings
set -euo pipefail

NATIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$NATIVE")"
# shellcheck source=versions.env
source "$NATIVE/versions.env"
# CMake's string(TIMESTAMP) honours this, which makes the Geogram build byte-for-byte reproducible
export SOURCE_DATE_EPOCH
CACHE="$NATIVE/.cache"
BUILD="$NATIVE/build"
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"
OUT_SUBDIV="$ROOT/engine/mesh/subdiv/wasm"
OUT_GEOGRAM="$ROOT/engine/mesh/uv/wasm"
# Native WASM exceptions everywhere, so C++ errors (and Geogram asserts) become typed errors, not aborts
EH_FLAGS="-fwasm-exceptions"

log() { printf '\033[1;34m[native]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[native] %s\033[0m\n' "$*" >&2; exit 1; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# ---------------------------------------------------------------- toolchain

# The standalone CPython uv installed under native/.python (empty if none)
emsdk_python() {
  UV_PYTHON_INSTALL_DIR="$NATIVE/.python" "$NATIVE/.venv/bin/uv" python find --no-project --managed-python "$PYTHON_VERSION" 2>/dev/null || true
}

toolchain() {
  if [ ! -x "$NATIVE/.venv/bin/python" ]; then
    log "creating native/.venv"
    python3 -m venv "$NATIVE/.venv"
  fi
  local pip="$NATIVE/.venv/bin/pip"
  if [ "$("$NATIVE/.venv/bin/cmake" --version 2>/dev/null | head -1 | awk '{print $3}')" != "$CMAKE_VERSION" ] \
    || [[ "$("$NATIVE/.venv/bin/ninja" --version 2>/dev/null)" != "$NINJA_VERSION"* ]]; then
    log "installing cmake $CMAKE_VERSION and ninja $NINJA_VERSION"
    "$pip" install --quiet --disable-pip-version-check "cmake==$CMAKE_VERSION" "ninja==$NINJA_VERSION"
  fi
  if [ "$("$NATIVE/.venv/bin/uv" --version 2>/dev/null | awk '{print $2}')" != "$UV_VERSION" ]; then
    "$pip" install --quiet --disable-pip-version-check "uv==$UV_VERSION"
  fi
  if [ -z "$(emsdk_python)" ]; then
    log "installing standalone Python $PYTHON_VERSION into native/.python (emsdk needs >= 3.10)"
    UV_PYTHON_INSTALL_DIR="$NATIVE/.python" "$NATIVE/.venv/bin/uv" python install --quiet "$PYTHON_VERSION"
  fi
  export EMSDK_PYTHON
  EMSDK_PYTHON="$(emsdk_python)"
  if [ ! -d "$NATIVE/.emsdk" ]; then
    log "cloning emsdk $EMSDK_VERSION"
    git clone --quiet --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk.git "$NATIVE/.emsdk"
  fi
  if [ ! -f "$NATIVE/.emsdk/.installed-$EMSDK_VERSION" ]; then
    log "installing Emscripten $EMSDK_VERSION (first run downloads ~500 MB)"
    (cd "$NATIVE/.emsdk" && ./emsdk install "$EMSDK_VERSION" >/dev/null && ./emsdk activate "$EMSDK_VERSION" >/dev/null)
    touch "$NATIVE/.emsdk/.installed-$EMSDK_VERSION"
  fi
}

activate() {
  export PATH="$NATIVE/.venv/bin:$PATH"
  export EMSDK_PYTHON
  EMSDK_PYTHON="$(emsdk_python)"
  [ -n "$EMSDK_PYTHON" ] || die "no Python for emsdk; run native/build.sh toolchain"
  # shellcheck disable=SC1091
  EMSDK_QUIET=1 source "$NATIVE/.emsdk/emsdk_env.sh" >/dev/null
  command -v emcc >/dev/null || die "emcc not found after activating emsdk"
  # Geogram's Emscripten platform file looks the toolchain up through $EMSCRIPTEN
  export EMSCRIPTEN="$NATIVE/.emsdk/upstream/emscripten"
}

# ---------------------------------------------------------------- sources

fetch() { # name url sha256
  local name="$1" url="$2" want="$3" archive="$CACHE/$1.tar.gz"
  mkdir -p "$CACHE/src"
  if [ ! -f "$archive" ] || [ "$(sha256 "$archive")" != "$want" ]; then
    log "downloading $name"
    curl -sSfL --retry 3 -o "$archive.part" "$url"
    mv "$archive.part" "$archive"
  fi
  local got
  got="$(sha256 "$archive")"
  [ "$got" = "$want" ] || die "$name: SHA-256 mismatch (got $got, want $want)"
  if [ ! -f "$CACHE/src/$name/.extracted-$want" ]; then
    rm -rf "$CACHE/src/$name"
    mkdir -p "$CACHE/src/$name"
    tar -xzf "$archive" -C "$CACHE/src/$name" --strip-components 1
    touch "$CACHE/src/$name/.extracted-$want"
  fi
}

sources() {
  fetch opensubdiv "$OPENSUBDIV_URL" "$OPENSUBDIV_SHA256"
  fetch geogram "$GEOGRAM_URL" "$GEOGRAM_SHA256"
}

# ---------------------------------------------------------------- libraries

build_opensubdiv() {
  log "building OpenSubdiv $OPENSUBDIV_TAG (Far + Osd CPU only)"
  emcmake cmake --fresh -G Ninja -S "$CACHE/src/opensubdiv" -B "$BUILD/opensubdiv" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
    -DCMAKE_CXX_FLAGS="$EH_FLAGS" -DCMAKE_C_FLAGS="$EH_FLAGS" \
    -DNO_OPENGL=ON -DNO_CUDA=ON -DNO_OPENCL=ON -DNO_METAL=ON -DNO_DX=ON -DNO_CLEW=ON -DNO_GLEW=ON \
    -DNO_TBB=ON -DNO_OMP=ON -DNO_PTEX=ON -DNO_GLFW=ON -DNO_GLFW_X11=ON \
    -DNO_EXAMPLES=ON -DNO_TUTORIALS=ON -DNO_REGRESSION=ON -DNO_TESTS=ON -DNO_GLTESTS=ON -DNO_DOC=ON \
    -DNO_MACOS_FRAMEWORK=ON >"$BUILD/opensubdiv.configure.log" 2>&1 || { tail -30 "$BUILD/opensubdiv.configure.log"; die "OpenSubdiv configure failed"; }
  cmake --build "$BUILD/opensubdiv" --target osd_static_cpu -j "$JOBS" >"$BUILD/opensubdiv.build.log" 2>&1 \
    || { tail -30 "$BUILD/opensubdiv.build.log"; die "OpenSubdiv build failed"; }
}

build_geogram() {
  log "building Geogram $GEOGRAM_VERSION (library only; TetGen/Triangle/HLBFGS off)"
  emcmake cmake --fresh -G Ninja -S "$CACHE/src/geogram" -B "$BUILD/geogram" \
    -DVORPALINE_PLATFORM=Emscripten-clang -DEMSCRIPTEN_DIR="$EMSCRIPTEN" -DCMAKE_BUILD_TYPE=Release -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
    -DCMAKE_CXX_FLAGS="$EH_FLAGS" -DCMAKE_C_FLAGS="$EH_FLAGS" \
    -DGEOGRAM_LIB_ONLY=ON -DGEOGRAM_WITH_GRAPHICS=OFF -DGEOGRAM_WITH_LUA=OFF \
    -DGEOGRAM_WITH_TETGEN=OFF -DGEOGRAM_WITH_TRIANGLE=OFF -DGEOGRAM_WITH_HLBFGS=OFF \
    -DGEOGRAM_WITH_EXPLORAGRAM=OFF -DGEOGRAM_WITH_LEGACY_NUMERICS=OFF -DGEOGRAM_WITH_PDEL=OFF \
    -DGEOGRAM_WITH_TBB=OFF -DGEOGRAM_WITH_FPG=OFF -DGEOGRAM_WITH_GARGANTUA=OFF -DGEOGRAM_WITH_VORPALINE=OFF \
    >"$BUILD/geogram.configure.log" 2>&1 || { tail -30 "$BUILD/geogram.configure.log"; die "Geogram configure failed"; }
  cmake --build "$BUILD/geogram" --target geogram -j "$JOBS" >"$BUILD/geogram.build.log" 2>&1 \
    || { grep -m5 -B2 -A8 "error:" "$BUILD/geogram.build.log"; die "Geogram build failed"; }
  license_guard "$BUILD/geogram/compile_commands.json"
}

# TetGen (AGPL), Triangle (no-compensation licence) and HLBFGS (non-commercial) must never be compiled in
license_guard() {
  local hits
  hits="$(grep -oE '"file": *"[^"]*third_party/(tetgen|triangle|HLBFGS)/[^"]*"' "$1" || true)"
  [ -z "$hits" ] || die "licence guard: forbidden third-party sources were compiled:\n$hits"
  log "licence guard: no TetGen/Triangle/HLBFGS sources in the build"
}

# ---------------------------------------------------------------- bindings

# Shared link flags: ES module factory usable in browsers, workers and Node
LINK_FLAGS=(
  -O3 "$EH_FLAGS" -lembind
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1 -sINCOMING_MODULE_JS_API=wasmBinary,locateFile
)

link_opensubdiv() {
  mkdir -p "$OUT_SUBDIV"
  em++ -std=c++17 -O3 "$EH_FLAGS" -I"$CACHE/src/opensubdiv" -I"$BUILD/opensubdiv" \
    "$NATIVE/opensubdiv/binding.cpp" "$BUILD/opensubdiv/lib/libosdCPU.a" \
    "${LINK_FLAGS[@]}" -sEXPORT_NAME=createOpenSubdiv -sFILESYSTEM=0 \
    --emit-tsd "$OUT_SUBDIV/opensubdiv.d.ts" -o "$OUT_SUBDIV/opensubdiv.js"
}

link_geogram() {
  mkdir -p "$OUT_GEOGRAM"
  em++ -std=c++17 -O3 "$EH_FLAGS" -frounding-math -ffp-contract=off \
    -DGEOGRAM_USE_BUILTIN_DEPS -DNL_WITH_AMGCL -DNDEBUG -D_LIBCPP_REMOVE_TRANSITIVE_INCLUDES \
    -I"$CACHE/src/geogram/src/lib" -I"$CACHE/src/geogram/src/lib/geogram/third_party/amgcl" -I"$BUILD/geogram/src/lib" \
    "$NATIVE/geogram/binding.cpp" "$BUILD/geogram/lib/libgeogram.a" \
    "${LINK_FLAGS[@]}" -sEXPORT_NAME=createGeogram -sSTACK_SIZE=4MB \
    `# Geogram's Emscripten code touches the JS FS during initialize(); pre.js keeps host dirs unmounted` \
    --pre-js "$NATIVE/geogram/pre.js" \
    --emit-tsd "$OUT_GEOGRAM/geogram.d.ts" -o "$OUT_GEOGRAM/geogram.js"
}

report_sizes() {
  log "WASM sizes:"
  for f in "$OUT_SUBDIV/opensubdiv.wasm" "$OUT_GEOGRAM/geogram.wasm"; do
    [ -f "$f" ] || continue
    printf '  %-28s %8s KiB  (gzip %s KiB)\n' "$(basename "$f")" "$(( $(wc -c <"$f") / 1024 ))" "$(( $(gzip -9c "$f" | wc -c) / 1024 ))"
  done
}

# Licence texts shipped next to the .wasm files: OpenSubdiv (Apache 2.0 + NOTICE), Geogram (BSD-3) and
# every Geogram third-party library that was actually compiled in (taken from compile_commands.json)
licenses() {
  local sd="$OUT_SUBDIV/LICENSES" gd="$OUT_GEOGRAM/LICENSES" tp="$CACHE/src/geogram/src/lib/geogram/third_party"
  rm -rf "$sd" "$gd"
  mkdir -p "$sd" "$gd"
  cp "$CACHE/src/opensubdiv/LICENSE.txt" "$sd/opensubdiv-LICENSE.txt"
  cp "$CACHE/src/opensubdiv/NOTICE.txt" "$sd/opensubdiv-NOTICE.txt"
  cp "$CACHE/src/geogram/LICENSE" "$gd/geogram-LICENSE.txt"
  local dir
  for dir in $(grep -oE 'third_party/[A-Za-z0-9_]+/' "$BUILD/geogram/compile_commands.json" | sort -u | cut -d/ -f2); do
    case "$dir" in
      OpenNL) ;; # part of Geogram, covered by its licence
      xatlas) sed -n '1,/^\*\//p' "$tp/xatlas/xatlas.cpp" >"$gd/xatlas-LICENSE.txt" ;; # MIT text lives in the source header
      *) for f in "$tp/$dir"/LICENSE*; do [ -f "$f" ] && cp "$f" "$gd/$dir-LICENSE.txt"; done ;;
    esac
  done
  cp "$tp/amgcl/LICENSE.md" "$gd/amgcl-LICENSE.txt" # header-only, used by OpenNL (NL_WITH_AMGCL)
  log "licences: $(ls "$sd" "$gd" | grep -c LICENSE) files"
}

bindings() {
  log "linking bindings (embind + --emit-tsd)"
  link_opensubdiv
  link_geogram
  licenses
  report_sizes
}

stage() {
  mkdir -p "$BUILD"
  case "$1" in
    toolchain) toolchain ;;
    sources) sources ;;
    opensubdiv) activate; build_opensubdiv ;;
    geogram) activate; build_geogram ;;
    bindings) activate; bindings ;;
    all) toolchain; sources; activate; build_opensubdiv; build_geogram; bindings ;;
    *) die "unknown stage '$1'" ;;
  esac
}

stage "${1:-all}"
