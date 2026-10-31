// Embind binding for OpenSubdiv Far (CPU only): uniform Catmull-Clark / Loop subdivision of an n-gon mesh
// with optional face-varying uvs. Every call copies its inputs in and its outputs out, so no C++ object
// outlives a call and JS never has to delete anything.
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <opensubdiv/far/error.h>
#include <opensubdiv/far/primvarRefiner.h>
#include <opensubdiv/far/topologyDescriptor.h>

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <tuple>
#include <vector>

using namespace emscripten;
using namespace OpenSubdiv;

// Typed `val`s so --emit-tsd writes real TypeScript types instead of `any`
EMSCRIPTEN_DECLARE_VAL_TYPE(Float32ArrayIn);
EMSCRIPTEN_DECLARE_VAL_TYPE(Uint32ArrayIn);
EMSCRIPTEN_DECLARE_VAL_TYPE(SubdivResult);

namespace {

struct Vec3 {
  float p[3];
  void Clear(void* = nullptr) { p[0] = p[1] = p[2] = 0.f; }
  void AddWithWeight(Vec3 const& s, float w) {
    p[0] += w * s.p[0];
    p[1] += w * s.p[1];
    p[2] += w * s.p[2];
  }
};

struct Vec2 {
  float p[2];
  void Clear(void* = nullptr) { p[0] = p[1] = 0.f; }
  void AddWithWeight(Vec2 const& s, float w) {
    p[0] += w * s.p[0];
    p[1] += w * s.p[1];
  }
};

std::string g_error;

void onError(Far::ErrorType, const char* message) { g_error = message ? message : "OpenSubdiv error"; }

template <typename T>
val toTyped(const char* ctor, const std::vector<T>& data) {
  // Copy out of the WASM heap so the JS array stays valid after this call returns
  return val::global(ctor).new_(typed_memory_view(data.size(), data.data())).template call<val>("slice");
}

SubdivResult fail(const std::string& message) {
  val out = val::object();
  out.set("ok", false);
  out.set("error", message);
  return SubdivResult(out);
}

}  // namespace

/**
 * positions: Float32Array xyz per vertex; faceSizes / faceVertices: Uint32Array n-gon loops;
 * cornerUvs: Float32Array uv per face corner, or empty; scheme 0 = Catmull-Clark, 1 = Loop.
 * Returns { ok, positions, faceSizes, faceVertices, cornerUvs? } or { ok: false, error }.
 */
SubdivResult subdivide(Float32ArrayIn positionsJs, Uint32ArrayIn faceSizesJs, Uint32ArrayIn faceVerticesJs, Float32ArrayIn cornerUvsJs,
                       int levels, int scheme) {
  try {
    const std::vector<float> positions = convertJSArrayToNumberVector<float>(positionsJs);
    const std::vector<int> sizes = convertJSArrayToNumberVector<int>(faceSizesJs);
    const std::vector<int> verts = convertJSArrayToNumberVector<int>(faceVerticesJs);
    const std::vector<float> uvs = convertJSArrayToNumberVector<float>(cornerUvsJs);
    const int nv = static_cast<int>(positions.size() / 3);
    const bool hasUv = !uvs.empty();
    if (hasUv && uvs.size() != verts.size() * 2) return fail("cornerUvs must have 2 values per face corner");

    // Weld uv values per (vertex, u, v) so seams stay where the uvs actually differ
    std::vector<int> uvIndex;
    std::vector<Vec2> uvValues;
    if (hasUv) {
      std::map<std::tuple<int, float, float>, int> seen;
      uvIndex.reserve(verts.size());
      for (size_t c = 0; c < verts.size(); ++c) {
        auto key = std::make_tuple(verts[c], uvs[c * 2], uvs[c * 2 + 1]);
        auto it = seen.find(key);
        if (it == seen.end()) {
          it = seen.emplace(key, static_cast<int>(uvValues.size())).first;
          uvValues.push_back(Vec2{{uvs[c * 2], uvs[c * 2 + 1]}});
        }
        uvIndex.push_back(it->second);
      }
    }

    Far::TopologyDescriptor desc;
    desc.numVertices = nv;
    desc.numFaces = static_cast<int>(sizes.size());
    desc.numVertsPerFace = sizes.data();
    desc.vertIndicesPerFace = verts.data();
    Far::TopologyDescriptor::FVarChannel channel;
    if (hasUv) {
      channel.numValues = static_cast<int>(uvValues.size());
      channel.valueIndices = uvIndex.data();
      desc.numFVarChannels = 1;
      desc.fvarChannels = &channel;
    }

    Sdc::Options sdcOptions;
    sdcOptions.SetVtxBoundaryInterpolation(Sdc::Options::VTX_BOUNDARY_EDGE_ONLY);
    sdcOptions.SetFVarLinearInterpolation(Sdc::Options::FVAR_LINEAR_BOUNDARIES);
    const Sdc::SchemeType type = scheme == 1 ? Sdc::SCHEME_LOOP : Sdc::SCHEME_CATMARK;

    g_error.clear();
    Far::SetErrorCallback(onError);
    std::unique_ptr<Far::TopologyRefiner> refiner(Far::TopologyRefinerFactory<Far::TopologyDescriptor>::Create(
        desc, Far::TopologyRefinerFactory<Far::TopologyDescriptor>::Options(type, sdcOptions)));
    if (!refiner) return fail(g_error.empty() ? "invalid topology for this scheme" : g_error);

    Far::TopologyRefiner::UniformOptions uniform(levels);
    uniform.fullTopologyInLastLevel = true;
    refiner->RefineUniform(uniform);

    // Interpolate level by level into one buffer holding every level
    std::vector<Vec3> vbuffer(refiner->GetNumVerticesTotal());
    for (int i = 0; i < nv; ++i) vbuffer[i] = Vec3{{positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]}};
    std::vector<Vec2> fvbuffer(hasUv ? refiner->GetNumFVarValuesTotal(0) : 0);
    for (size_t i = 0; i < uvValues.size(); ++i) fvbuffer[i] = uvValues[i];

    Far::PrimvarRefiner primvar(*refiner);
    Vec3* src = vbuffer.data();
    Vec2* fsrc = fvbuffer.data();
    for (int level = 1; level <= levels; ++level) {
      Vec3* dst = src + refiner->GetLevel(level - 1).GetNumVertices();
      primvar.Interpolate(level, src, dst);
      src = dst;
      if (hasUv) {
        Vec2* fdst = fsrc + refiner->GetLevel(level - 1).GetNumFVarValues(0);
        primvar.InterpolateFaceVarying(level, fsrc, fdst);
        fsrc = fdst;
      }
    }

    Far::TopologyLevel const& last = refiner->GetLevel(levels);
    const int outVerts = last.GetNumVertices();
    std::vector<float> outPositions(static_cast<size_t>(outVerts) * 3);
    for (int i = 0; i < outVerts; ++i) {
      for (int k = 0; k < 3; ++k) outPositions[i * 3 + k] = src[i].p[k];
    }
    std::vector<uint32_t> outSizes;
    std::vector<uint32_t> outFaceVerts;
    std::vector<float> outUvs;
    outSizes.reserve(last.GetNumFaces());
    for (int f = 0; f < last.GetNumFaces(); ++f) {
      Far::ConstIndexArray fv = last.GetFaceVertices(f);
      outSizes.push_back(static_cast<uint32_t>(fv.size()));
      for (int k = 0; k < fv.size(); ++k) outFaceVerts.push_back(static_cast<uint32_t>(fv[k]));
      if (hasUv) {
        Far::ConstIndexArray fuv = last.GetFaceFVarValues(f, 0);
        for (int k = 0; k < fuv.size(); ++k) {
          outUvs.push_back(fsrc[fuv[k]].p[0]);
          outUvs.push_back(fsrc[fuv[k]].p[1]);
        }
      }
    }

    val out = val::object();
    out.set("ok", true);
    out.set("positions", toTyped("Float32Array", outPositions));
    out.set("faceSizes", toTyped("Uint32Array", outSizes));
    out.set("faceVertices", toTyped("Uint32Array", outFaceVerts));
    if (hasUv) out.set("cornerUvs", toTyped("Float32Array", outUvs));
    return SubdivResult(out);
  } catch (const std::exception& e) {
    return fail(e.what());
  } catch (...) {
    return fail("unknown OpenSubdiv exception");
  }
}

EMSCRIPTEN_BINDINGS(linden_opensubdiv) {
  register_type<Float32ArrayIn>("Float32Array");
  register_type<Uint32ArrayIn>("Uint32Array");
  register_type<SubdivResult>(
      "{ ok: true; positions: Float32Array; faceSizes: Uint32Array; faceVertices: Uint32Array; cornerUvs?: Float32Array }"
      " | { ok: false; error: string }");
  function("subdivide", &subdivide);
}
