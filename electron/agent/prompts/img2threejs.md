# img2threejs (optional, enabled with LINDEN_IMG2THREEJS=1)

When this section is present, the img2threejs tools are available as an alternative to section 7 for detailed, quality-gated reconstructions:

- `linden_img2_status`, `linden_img2_read`, `linden_img2_run`, `linden_img2_write`: rebuild an object from a reference image with img2threejs.

## 7b. Rebuilding an object with img2threejs

Use this when the user gives a **reference image** (attached files land in `references/`) and wants *that* object rebuilt. For objects described only in words, quick blockouts, or when Python is missing, use section 6 (`linden_model_build` with parts).

img2threejs is a staged, quality-gated pipeline: deterministic Python scripts validate and gate, you do the visual judgement. Its output is a TypeScript factory in `models/` (`create<Name>Model(): THREE.Group`) that Linden runs as a `Model` with `factory`.

1. **Check**: `linden_img2_status`. If `ready` is false, tell the user the `pythonError` (they need Python 3.10+) and fall back to section 6.
2. **Read the skill**: `linden_img2_read {path: "SKILL.md"}` and follow its order. Read the `grimoire/...` or `docs/...` file a step names (with `linden_img2_read`) when you reach that step, not before.
3. **Run every `python3 forge/<script> <args>` step as** `linden_img2_run {job, script: "<script>", args: [...]}`. Never run forge scripts through the shell and never install anything.
   - `job` is a slug for this reconstruction (`"kursi-jati"`). Its folder `.linden/img2threejs/<job>/` is the working directory: relative paths (`assessment.json`, `object-sculpt-spec.json`, `.img2threejs/state.json`, `cmp.png`) live there.
   - The reference image is `references/<file>`; generate the factory with `--out models/<job>/create<Name>Model.ts`.
   - Start with `state.py init --state .img2threejs/state.json --reference references/<file> --profile generic|character --spec object-sculpt-spec.json`, then run `next.py --state .img2threejs/state.json` at every start, resume and before every correction.
   - `hardStop: true` (exit 3 / `status=stopped`) is a hard stop: report the reason and ask the user. Never bypass a gate, never use `--allow-nonstrict`.
   - You write the spec content yourself from your image analysis; the scripts only scaffold, validate and gate it. Write job files with `linden_img2_write {job, path: "object-sculpt-spec.json", patch: {...}}` (JSON merge patch) or `content` for a whole file, not with the generic edit tools.
4. **Render step** ("render the current pass in a browser/preview" in SKILL.md): `linden_model_build {name, entityId, model: {factory: "models/<job>/create<Name>Model.ts", category?, placement, collider}, fitHeight?}` places and measures it (sizes in meters from `category` or `fitHeight`; the factory's own units are relative). Then `linden_render_preview {entityId, views: ["front","side","top","threeQuarter"]}`; the PNGs are saved under `.linden/previews/<entityId>-<view>.png`.
   - Comparison: `linden_img2_run {script: "stage4_review/make_comparison_sheet.py", args: ["--reference", "references/<file>", "--render", ".linden/previews/<entityId>-front.png", "--out", "cmp.png", "--json"]}` returns the sheet image; judge it and record it with `append_review.py`.
   - Turntable gate captures: `--capture 0=.linden/previews/<id>-front.png --capture 90=.linden/previews/<id>-side.png`.
   - Mesh gates (`self_intersection.py`) need `meshes.json`: pass `meshesOut: ".linden/img2threejs/<job>/meshes.json"` to `linden_model_build`, then run the gate on `meshes.json`.
   - Call `linden_model_build` again after every factory regeneration, so the editor, colliders and physics see the new version.
5. **Limits in Linden**: profiles `generic` and `character` only. Plugin profiles (cs2, animated-character, environment), the `img2` harness, `--target` emission and photo-texture projection are not available; if `next.py` asks for them, tell the user. Mark such steps `skipped` with a `--reason` only when the skill allows it.
6. **Report honestly**: which regions are inferred (hidden sides), per-region confidence, and that a single image cannot guarantee exact geometry. Characters are stylized reconstructions.
7. **Use it in the game**: a factory model gets a collider from `collider` (`compound` = one box per factory collider), plays its idle animation (`userData.tick`) in Play, and exposes sockets/nodes to scripts through `ctx.model`. For a GLB copy (heavy model, other engines): `linden_model_bake_glb {entityId, switch?}`.
