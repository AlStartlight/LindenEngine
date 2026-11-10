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

| Flag | Effect |
|---|---|
| `-b` | Background mode |
| `--factory-startup` | No user preferences, add-ons or startup file |
| `-Y` | Auto-run of Python in .blend files is disabled |
| `--offline-mode` | No online access |

The working folder is `<project>/.linden/agent/blender/<job>/`. Linden also clears `PYTHON*`/`BLENDER_*` variables and points the Blender user script and config folders at that job folder. Each run is killed after 120 seconds.

A successful run prints one line `LINDEN_RESULT:{"objects":…,"triangles":…,"bounds":{"min":[…],"max":[…]},"materials":[…],"warnings":[…]}` on stdout. Bounds are in Blender axes (Z up, meters, after placing the model on z = 0). A failed run prints `LINDEN_ERROR:<message>` on stderr and exits with code 1.

The spec format is `BlenderSpecSchema` in `shared/blenderSpec.ts`. `runner.py` checks it again on its own side.
