// Embind binding for the Geogram operations Linden uses: UV atlas (LSCM / ABF++ packed with xatlas),
// CVT remeshing (Lloyd only: Newton needs HLBFGS, which is not built for licence reasons), Laplacian
// smoothing and repair (colocate, drop duplicate/degenerate facets, fill holes). Triangle meshes in and out;
// every call copies its data in and out, so nothing has to be deleted from JS.
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <geogram/basic/command_line.h>
#include <geogram/basic/command_line_args.h>
#include <geogram/basic/common.h>
#include <geogram/basic/logger.h>
#include <geogram/mesh/mesh.h>
#include <geogram/mesh/mesh_fill_holes.h>
#include <geogram/mesh/mesh_geometry.h>
#include <geogram/mesh/mesh_remesh.h>
#include <geogram/mesh/mesh_repair.h>
#include <geogram/parameterization/mesh_atlas_maker.h>
#include <geogram/NL/nl.h>

#include <cstdint>
#include <string>
#include <vector>

using namespace emscripten;

EMSCRIPTEN_DECLARE_VAL_TYPE(Float32ArrayIn);
EMSCRIPTEN_DECLARE_VAL_TYPE(Uint32ArrayIn);
EMSCRIPTEN_DECLARE_VAL_TYPE(GeogramResult);

namespace {

// OpenNL reports optional solver plug-ins it cannot load (no dlopen in WASM) on stderr; results and real
// errors come back through return values, so its console chatter is dropped
int quietPrintf(const char*, ...) { return 0; }
int quietFprintf(FILE*, const char*, ...) { return 0; }

void ensureInitialized() {
  static bool done = false;
  if (done) return;
  done = true;
  GEO::initialize(GEO::GEOGRAM_INSTALL_NONE);
  GEO::CmdLine::import_arg_group("standard");
  GEO::CmdLine::import_arg_group("algo");
  GEO::CmdLine::import_arg_group("remesh");
  GEO::CmdLine::set_arg("sys:assert", "throw");
  GEO::Logger::instance()->set_quiet(true);
  nlPrintfFuncs(quietPrintf, quietFprintf);
}

template <typename T>
val toTyped(const char* ctor, const std::vector<T>& data) {
  return val::global(ctor).new_(typed_memory_view(data.size(), data.data())).template call<val>("slice");
}

GeogramResult fail(const std::string& message) {
  val out = val::object();
  out.set("ok", false);
  out.set("error", message);
  return GeogramResult(out);
}

/** Builds a Geogram surface mesh; returns an error message or "" */
std::string load(GEO::Mesh& M, const Float32ArrayIn& positionsJs, const Uint32ArrayIn& indicesJs) {
  const std::vector<float> p = convertJSArrayToNumberVector<float>(positionsJs);
  const std::vector<uint32_t> idx = convertJSArrayToNumberVector<uint32_t>(indicesJs);
  if (p.size() % 3 != 0 || idx.size() % 3 != 0) return "positions and indices must be multiples of 3";
  const GEO::index_t nv = static_cast<GEO::index_t>(p.size() / 3);
  for (uint32_t i : idx) if (i >= nv) return "index out of range";
  M.vertices.create_vertices(nv);
  for (GEO::index_t v = 0; v < nv; ++v) {
    double* q = M.vertices.point_ptr(v);
    q[0] = p[v * 3];
    q[1] = p[v * 3 + 1];
    q[2] = p[v * 3 + 2];
  }
  const GEO::index_t nt = static_cast<GEO::index_t>(idx.size() / 3);
  M.facets.create_triangles(nt);
  for (GEO::index_t t = 0; t < nt; ++t) {
    for (GEO::index_t k = 0; k < 3; ++k) M.facets.set_vertex(t, k, idx[t * 3 + k]);
  }
  M.facets.connect();
  return "";
}

/** Triangle mesh out: { ok, positions, indices, cornerUvs? } (uvs from the "tex_coord" corner attribute) */
GeogramResult store(GEO::Mesh& M, bool withUvs) {
  if (!M.facets.are_simplices()) M.facets.triangulate();
  std::vector<float> positions(static_cast<size_t>(M.vertices.nb()) * 3);
  for (GEO::index_t v = 0; v < M.vertices.nb(); ++v) {
    const double* q = M.vertices.point_ptr(v);
    for (int k = 0; k < 3; ++k) positions[v * 3 + k] = static_cast<float>(q[k]);
  }
  std::vector<uint32_t> indices;
  std::vector<float> uvs;
  GEO::Attribute<double> tex;
  if (withUvs) tex.bind_if_is_defined(M.facet_corners.attributes(), "tex_coord");
  indices.reserve(static_cast<size_t>(M.facets.nb()) * 3);
  for (GEO::index_t f = 0; f < M.facets.nb(); ++f) {
    for (GEO::index_t c = M.facets.corners_begin(f); c < M.facets.corners_end(f); ++c) {
      indices.push_back(M.facet_corners.vertex(c));
      if (tex.is_bound()) {
        uvs.push_back(static_cast<float>(tex[c * 2]));
        uvs.push_back(static_cast<float>(tex[c * 2 + 1]));
      }
    }
  }
  val out = val::object();
  out.set("ok", true);
  out.set("positions", toTyped("Float32Array", positions));
  out.set("indices", toTyped("Uint32Array", indices));
  if (tex.is_bound()) out.set("cornerUvs", toTyped("Float32Array", uvs));
  return GeogramResult(out);
}

template <typename Fn>
GeogramResult guarded(Fn fn) {
  try {
    ensureInitialized();
    return fn();
  } catch (const std::exception& e) {
    return fail(e.what());
  } catch (...) {
    return fail("unknown Geogram exception");
  }
}

}  // namespace

/** method 0 = LSCM, 1 = ABF++; charts split at dihedral angles above hardAngle (degrees), packed with xatlas */
GeogramResult unwrapUV(Float32ArrayIn positions, Uint32ArrayIn indices, int method, double hardAngle) {
  return guarded([&]() {
    GEO::Mesh M;
    std::string e = load(M, positions, indices);
    if (!e.empty()) return fail(e);
    GEO::mesh_repair(M, GEO::MESH_REPAIR_DEFAULT);
    if (M.facets.nb() == 0) return fail("mesh has no valid triangles");
    GEO::mesh_make_atlas(M, hardAngle, method == 1 ? GEO::PARAM_ABF : GEO::PARAM_LSCM, GEO::PACK_XATLAS, false);
    return store(M, true);
  });
}

/** Isotropic CVT remesh to about nbPoints vertices (Lloyd iterations) */
GeogramResult remesh(Float32ArrayIn positions, Uint32ArrayIn indices, int nbPoints, int lloydIterations) {
  return guarded([&]() {
    GEO::Mesh in;
    std::string e = load(in, positions, indices);
    if (!e.empty()) return fail(e);
    GEO::mesh_repair(in, GEO::MESH_REPAIR_DEFAULT);
    if (in.facets.nb() == 0) return fail("mesh has no valid triangles");
    GEO::Mesh out;
    GEO::remesh_smooth(in, out, static_cast<GEO::index_t>(nbPoints), 3, static_cast<GEO::index_t>(lloydIterations), 0);
    if (out.facets.nb() == 0) return fail("remeshing produced no triangles");
    return store(out, false);
  });
}

/** Laplacian smoothing: each vertex moves to the barycenter of its neighbours, `iterations` times */
GeogramResult smooth(Float32ArrayIn positions, Uint32ArrayIn indices, int iterations) {
  return guarded([&]() {
    GEO::Mesh M;
    std::string e = load(M, positions, indices);
    if (!e.empty()) return fail(e);
    // The smoother keeps vertex normals in coordinates 3..5, so it needs 6-dimensional vertices
    M.vertices.set_dimension(6);
    GEO::simple_Laplacian_smooth(M, static_cast<GEO::index_t>(iterations), false);
    return store(M, false);
  });
}

/** Colocates vertices, removes duplicate/degenerate facets, fills holes up to maxHoleEdges edges */
GeogramResult repair(Float32ArrayIn positions, Uint32ArrayIn indices, double colocateEpsilon, int maxHoleEdges) {
  return guarded([&]() {
    GEO::Mesh M;
    std::string e = load(M, positions, indices);
    if (!e.empty()) return fail(e);
    GEO::mesh_repair(M, GEO::MESH_REPAIR_DEFAULT, colocateEpsilon);
    GEO::fill_holes(M, 1e30, maxHoleEdges > 0 ? static_cast<GEO::index_t>(maxHoleEdges) : GEO::max_index_t(), true);
    GEO::mesh_repair(M, GEO::MESH_REPAIR_DEFAULT, colocateEpsilon);
    return store(M, false);
  });
}

EMSCRIPTEN_BINDINGS(linden_geogram) {
  register_type<Float32ArrayIn>("Float32Array");
  register_type<Uint32ArrayIn>("Uint32Array");
  register_type<GeogramResult>(
      "{ ok: true; positions: Float32Array; indices: Uint32Array; cornerUvs?: Float32Array } | { ok: false; error: string }");
  function("unwrapUV", &unwrapUV);
  function("remesh", &remesh);
  function("smooth", &smooth);
  function("repair", &repair);
}
