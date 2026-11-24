# blender-bridge

Python scripts that run **inside the user's own Blender**. Linden uses them for the agent's "Blender 3D" mode (`linden_blender_build`, `linden_blender_script`).

## Licence

This folder is licensed under **GPL-3.0-or-later** (see `LICENSE`), because its code uses Blender's `bpy` API. The rest of Linden Engine stays MIT. The two are kept apart like this:

- Linden does not bundle, link or import Blender or `bpy`. The user installs Blender themselves.
- Linden starts Blender as a **separate process** (`spawn`, no shell). The two sides talk only through command-line arguments, files (`spec.json`, `script.py`, `out.glb`) and stdout/stderr lines.
- No TypeScript/JavaScript file imports anything from this folder. Linden only passes the path of `runner.py` to Blender. `npm run check:licenses` checks this.
- The packaged app ships this folder unchanged, with its `LICENSE`, as `resources/blender-bridge/`.

## How Linden calls it

```
blender -b --factory-startup -Y --offline-mode --python-exit-code 1 -P runner.py -- --spec spec.json --out out.glb
blender -b --factory-startup -Y --offline-mode --python-exit-code 1 -P runner.py -- --script script.py --out out.glb
```

Add `--previews <dir>` to render three review angles (three-quarter, front, side) after the export, so the agent can look at what it built before importing. The preview camera and studio lights are added after the GLB export and never end up in it.

| Flag | Effect |
|---|---|
| `-b` | Background mode |
| `--factory-startup` | No user preferences, add-ons or startup file |
| `-Y` | Auto-run of Python in .blend files is disabled |
| `--offline-mode` | No online access |

The working folder is `<project>/.linden/agent/blender/<job>/`. Linden also clears `PYTHON*`/`BLENDER_*` variables and points the Blender user script and config folders at that job folder. Each run is killed after 120 seconds.

A successful run prints one line `LINDEN_RESULT:{"objects":…,"triangles":…,"bounds":{"min":[…],"max":[…]},"materials":[…],"warnings":[…],"previews":[…]}` on stdout. Bounds are in Blender axes (Z up, meters, after placing the model on z = 0). A failed run prints `LINDEN_ERROR:<message>` on stderr and exits with code 1.

The spec format is `BlenderSpecSchema` in `shared/blenderSpec.ts`. `runner.py` checks it again on its own side. Objects accept `smoothAngle` (degrees, auto-smooth) and the `weightedNormal` modifier, which keeps bevels crisp on curved surfaces.

## Photoreal assets

The same runner also builds game-ready photoreal props:

- **`lathe`** primitive revolves a `[radius, z]` profile around Z (vases, bowls, columns, chess pieces).
  `profileSubdivisions` smooths a coarse outline with Catmull-Rom; textured lathes get a seam-free cylindrical UV.
- **`sculpt`** subdivides, displaces along normals with deterministic presets (`clay`, `stone`, `wood`, `fabric`,
  `hammered`, `organic`) or explicit layers (`noise`, `ridged`, `dents`, `wrinkles`, `grain`, `chips`), then
  decimates back into the triangle budget.
- **`material.texture`** generates albedo, ORM (AO/Roughness/Metallic) and tangent normal PNGs with numpy, wires
  them into Principled BSDF/glTF (including `clearcoat`), and embeds all three inside the exported GLB.
- **`grade`** applies Blender color management (AgX + look + exposure + white balance) and a display-referred CDL
  grade to the preview PNGs. Linden Engine implements the identical grade as `settings.colorGrade`, so a preview
  and the in-engine result match.
- **`preview`** renders three studio angles with Cycles (48 samples, 512 px by default) against a shadow-catching
  backdrop.

All textures are generated inside the job folder and packed into the GLB; no loose texture files are written to
the project. See `docs/specs/SPEC-Photoreal-Blender-Pipeline.md` and the runnable
`samples/photoreal-vase/` example.
