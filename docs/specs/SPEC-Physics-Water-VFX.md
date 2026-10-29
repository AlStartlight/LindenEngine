# SPEC: Physics Joints, Water and Particle VFX

Status: draft (2026-10-29). Target branch: new branch from `feat/realistic-3d`.

## Decision

Linden keeps **one physics engine (Rapier)** and adds three features on top of the existing pipeline:

1. **Physics depth on Rapier.** Joints, forces and torque, CCD, buoyancy.
2. **Water surface.** A `Water` component with reflection/refraction, rendered by three's own addons (`Water` for WebGL, `WaterMesh` for WebGPU).
3. **Particle VFX.** A `ParticleEmitter` component built in-engine, with presets for fire, smoke, sparks, explosion, magic, rain and splash.

Real fluid simulation (SPH/PBF/MLS-MPM) is **out of scope** for this spec. It is listed under Later.

## Why these choices

- **Rapier only.** `@dimforge/rapier3d-compat` already drives `RapierBackend`, `GameSimulation`, the character controller and the script API. Rapier already covers joints, CCD and forces.
  - cannon-es would be a slower second engine.
  - Ammo.js adds soft bodies, but its API is hard to use and the WASM is large.
  - Jolt would mean rewriting `PhysicsBackend`.
  - None of the three is justified while scenes are small.
- **Water from three addons.** `three/examples/jsm/objects/Water.js` (WebGL) and `WaterMesh.js` (WebGPU/TSL) ship with three r186, so there is no new dependency. The player picks WebGL or WebGPU per project (`createGameRenderer`), so both are needed.
- **In-engine particles instead of three.quarks / three-nebula.**
  - Both libraries build GLSL `ShaderMaterial`s, which `WebGPURenderer` cannot run.
  - Both have their own JSON formats, which do not fit `ComponentRegistry` serialization, the Inspector or the agent's `linden_scene_apply`.
  - A small CPU emitter drawn with one `InstancedMesh` per emitter, using built-in materials that both renderers support, covers game VFX at the counts Linden targets (≤ 2k particles per emitter).
- **No real fluids yet.** GPU fluids need WebGPU compute and give up the WebGL fallback. They also cannot run in headless `linden_play`, and gameplay cannot read them back cheaply. That is a separate project.

## Constraints from the current code

- **Same behaviour everywhere.** `GameSimulation` is shared by `LindenPlayer`, the editor Game Frame and headless `linden_play` in the Electron main process.
  - All gameplay-affecting logic (joints, buoyancy, forces) lives in `GameSimulation` / `RapierBackend`.
  - Visual-only parts (water shader, particles) live in `SceneBridge` / `engine/renderer`, which headless skips.
- **Main process bundling.** `scripts/build-electron.mjs` now inlines `three` because electron-builder strips `node_modules/**/examples` (fix `710673c`).
  - Engine modules imported by the main process must not lazy-load `three/examples/jsm/*` at runtime from `node_modules`.
  - Keep `Water` / `WaterMesh` / particle rendering imports out of anything `electron/` imports. They belong in `SceneBridge` render code only.
- **No external textures.** `three/examples/textures` is not in the npm package. Water normals and particle sprites are generated procedurally (see below).
- **Quality profiles.** `QUALITY_CAPS` (`engine/scene/SceneSettings.ts`) gains the caps used below.
- **Agent.** `linden_component_list` reads `ComponentRegistry`, so new components appear to the agent automatically. `electron/agent/prompts/linden.md` gets short usage notes.

## M1: Physics depth (Rapier)

### Components

| Component | Properties | Notes |
|---|---|---|
| `Rigidbody` (edit) | `ccd: boolean` (default `false`) | Maps to `RigidBodyDesc.setCcdEnabled`. For fast projectiles. |
| `Joint` (new) | `type: 'fixed' \| 'hinge' \| 'ball' \| 'slider'`, `connectedEntity: string` (entity id, empty = world), `anchor: vec3`, `connectedAnchor: vec3`, `axis: vec3` (hinge/slider), `limits: { enabled, min, max }`, `motor: { enabled, targetVelocity, maxForce }`, `breakForce: number` (0 = unbreakable), `onBreak: EventField` | Rapier `JointData.fixed/revolute/spherical/prismatic`. `menuPath: 'Physics/Joint'`. More than one per entity is allowed. |

Register both in `engine/ecs/ComponentRegistry.ts`, with classes in `engine/physics/components.ts` and `clone()` covering every field.

### RapierBackend / PhysicsBackend

- `createJoint(entityId, joint, connectedId | null)` and `removeJoints(entityId)`. Joints are created in `GameSimulation.initPhysics` **after** all bodies exist. A joint whose `connectedEntity` has no body attaches to a fixed world anchor and logs a warning once.
- `addForce(id, f)`, `addTorque(id, t)`, `setAngularVelocity`, `getAngularVelocity`.
- Breakable joints: after `step()`, read the impulse of each breakable joint and compare it with `breakForce * FIXED_DT`. When it is exceeded, remove the joint, then fire `onBreak` and the script hook `onJointBreak`.
- `removeBody` also removes the joints that reference that body. This is already called from `flushRemovals`.

### Script API (`ScriptPhysicsApi`)

Add `addForce`, `addTorque`, `setAngularVelocity`, `getAngularVelocity`, and `setMotor(jointIndex, targetVelocity, maxForce)`. Update the `linden` typings in `player/` and the script docs in `linden.md`.

### Ragdoll

There is no separate component. A ragdoll is a set of `Rigidbody` + `CapsuleCollider` + `Joint(ball, limits)` entities. `linden.md` gets a short recipe so the agent can build one. Skinned-mesh ragdoll binding is out of scope.

## M2: Water

### Component `Water`

| Property | Default | Notes |
|---|---|---|
| `size` | `{ x: 20, y: 20 }` | Plane in local XZ, at entity Y. |
| `color` | `#1e5f74` | |
| `sunDirection` | from the scene's first directional Light | Computed, not stored. |
| `distortion` | `3.7` | `Water.distortionScale` / `WaterMesh.distortionScale`. |
| `waveSpeed` | `1` | Time multiplier. |
| `reflections` | `true` | Off on the `low` quality profile. |
| `buoyancy` | `true` | Enables M2 physics below. |
| `density` | `1000` | kg/m³. |
| `linearDrag`, `angularDrag` | `1`, `0.5` | Extra drag while submerged. |

`menuPath: 'Environment/Water'`, `disallowMultiple: true`.

### Rendering (`SceneBridge` → new `engine/renderer/water.ts`)

- Backend chosen from the renderer:
  - `WebGPURenderer` → `WaterMesh` (lazy `import('three/examples/jsm/objects/WaterMesh.js')`);
  - WebGL → `Water`.
  - Expose the backend to `RenderContext` (it is already known in `player.ts` as `created.backend`).
- Normal map: a 256×256 tileable `DataTexture` built once from seeded value noise in `water.ts` (`RepeatWrapping`). This avoids the missing `waternormals.jpg`.
- `SceneBridge.update(dt)` advances `time` uniforms.
- Editor viewport: render the water too (it uses `createWebGLRenderer`), so edit and play look the same.
- Quality caps: `low` → plain `MeshPhysicalMaterial` plane (transmission off), no reflection render pass.

### Buoyancy (`GameSimulation.fixedStep`, before `physics.step`)

For every dynamic body whose collider AABB overlaps a `Water` volume (water plane XZ bounds × from `-∞` to surface Y):

```
submerged = clamp((surfaceY - aabb.minY) / aabb.height, 0, 1)
volume    = collider volume (box/sphere/capsule formula; Model auto collider → its shape)
Fb        = density * 9.81 * volume * submerged   (up, applied at AABB centre)
drag      = -velocity * linearDrag * submerged * mass; same for angular
```

- Pure function `buoyancyForce(...)` in `engine/physics/buoyancy.ts`, so it can be unit tested.
- Script hooks: `onEnterWater` / `onExitWater`, and events `water:enter` / `water:exit`, fired from the `submerged` crossing 0.
- `CharacterMovement` gets a flag `inWater` (read-only) for scripts. Swimming movement is out of scope.

## M3: Particle VFX

### Component `ParticleEmitter`

| Property | Default | Notes |
|---|---|---|
| `preset` | `'custom'` | `fire`, `smoke`, `sparks`, `explosion`, `magic`, `rain`, `splash`, `custom`. Selecting a preset fills the fields below (Inspector), and the fields stay editable. |
| `playOnStart` | `true` | |
| `loop` | `true` | |
| `duration` | `2` | Seconds per loop. |
| `rate` | `30` | Particles per second. |
| `bursts` | `[]` | `{ time, count }[]` |
| `maxParticles` | `500` | Clamped by the quality cap. |
| `shape` | `'cone'` | `point`, `sphere`, `box`, `cone`; with `shapeSize`, `coneAngle`. |
| `lifetime` | `{ min: 0.8, max: 1.2 }` | |
| `speed` | `{ min: 1, max: 2 }` | |
| `gravity` | `0` | Multiplier of world gravity (negative = rises, e.g. smoke). |
| `drag` | `0` | |
| `size` | curve `[{t,v}]` | Over normalized lifetime. |
| `color` | gradient `[{t, color, alpha}]` | Over lifetime. |
| `blending` | `'additive'` | `additive` (fire, sparks, magic) or `normal` (smoke, rain). |
| `texture` | `'soft'` | Procedural sprite: `soft`, `spark`, `smoke`, `square`; or an asset path. |
| `space` | `'world'` | `world` leaves trails behind a moving emitter; `local` follows it. |
| `seed` | `0` | 0 = random per play. Fixed seed → deterministic (tests, previews). |
| `light` | `{ enabled: false, color, intensity, flicker }` | Optional `PointLight` for fire/explosion. Counts against the scene light budget. |
| `onFinished` | `EventField` | Non-looping emitters, after the last particle dies. |

`menuPath: 'Effects/Particle Emitter'`. Several emitters per entity are allowed (fire + smoke).

### Engine split

- `engine/vfx/ParticleSim.ts`: **pure**, no three import.
  - Struct-of-arrays (`Float32Array` position, velocity, age, life, size, color) and a seeded PRNG.
  - `emit` / `step(dt)` / `aliveCount`.
  - Unit tested.
- `engine/vfx/particleRenderer.ts`: one `InstancedMesh` of a unit quad per emitter.
  - `instanceMatrix` is updated each frame (camera-facing billboard computed on CPU) and `instanceColor` carries colour.
  - Alpha is packed via a per-instance `InstancedBufferAttribute` read by an `onBeforeCompile` hook on WebGL, and by a node on `MeshBasicNodeMaterial` on WebGPU, behind a single `createParticleMaterial(backend, opts)`.
  - `depthWrite: false`, `transparent: true`, sorted by emitter (not per particle) for `normal` blending.
- `engine/vfx/presets.ts`: preset → field values. The agent uses these too.
- `engine/vfx/sprites.ts`: 64×64 procedural `CanvasTexture` / `DataTexture` sprites, cached per renderer.
- **Who runs the simulation.** VFX is visual only, so `SceneBridge.update(dt)` steps `ParticleSim`, not `GameSimulation`. Headless `linden_play` never creates emitters. Scripts must not rely on particle state for gameplay.
- **Editor.** Emitters preview in the viewport when the entity is selected, or when a toolbar toggle "Preview VFX" is on, so idle scenes do not burn CPU.

### Script API

`ctx.vfx`: `play(entity?)`, `stop(entity?, { clear })`, `burst(count, entity?)`, `spawn(preset, position, { parent?, autoDestroy: true })`. `spawn` creates a temporary entity with an emitter; this is the common "explosion at hit point" case.

### Quality caps

Add `maxParticlesPerEmitter` (`low` 200 / `medium` 1000 / `high` 2000) and `particleLights` (`low` false) to `QualityCaps`.

## Agent and docs

- `linden.md` covers:
  - the three new components and their presets;
  - the ragdoll recipe;
  - water with buoyancy;
  - `ctx.vfx.spawn` for hit effects.
- `linden_render_preview` gets particles at a fixed `seed` with simulated warm-up (`step` 1 s before the snapshot), so previews are not empty.
- Update `docs/API.md` and `docs/FEATURE_SUMMARY.md`.

## Web export

There are no new npm dependencies. The player runtime (`scripts/build-player.mjs`, rolldown) bundles `Water` / `WaterMesh` from three, so check that `dist-player` includes them as lazy chunks. Water and VFX must work in the HTML5 export on both renderer backends.

## Tests

| Area | Test |
|---|---|
| `Joint` | Registry round-trip; hinge with limits stays within limits after 120 steps; fixed joint keeps relative offset; `breakForce` breaks and fires `onBreak`; removing a body removes its joints. |
| Forces | `addForce` for 1 s on a 1 kg body gives Δv ≈ F (tolerance); `ccd` body at 200 m/s does not tunnel through a 0.1 m wall. |
| Buoyancy | `buoyancyForce` unit tests (fully, half, not submerged); density-500 box floats at ~50 % submerged after settling; `water:enter` / `water:exit` fire once each. |
| `ParticleSim` | Same seed gives the same positions; `rate` 30 over 1 s spawns 30 ± 1; never exceeds `maxParticles`; non-loop fires `onFinished` once. |
| Rendering | `createParticleMaterial` / water builder construct on both backends (WebGL in vitest via mocks; WebGPU covered by `tests/e2e/renderPreview.e2e.mjs`). |
| Headless | `linden_play` on a scene with `Water` + `ParticleEmitter` runs without importing any `three/examples` module in the main process. |
| Packaging | CI smoke: start the packaged app and open a scene with water + emitter (guards against the `710673c` class of bug). |

## Milestones

| | Scope | Done when |
|---|---|---|
| M1 | `Joint`, CCD, forces/torque, script API, ragdoll recipe | Joint and force tests green; agent can build a swinging door and a chain. |
| M2 | `Water` render (both backends) + buoyancy | Crate floats in Play, editor and web export on WebGL and WebGPU. |
| M3 | `ParticleEmitter`, presets, `ctx.vfx`, preview | Each preset previews in the viewport; `spawn('explosion')` works from a collision script. |
| M4 | Agent prompt, docs, packaging smoke test | Prompt "campfire beside a lake with a floating barrel" produces a working scene. |

## Later (not in this spec)

- Interactive water (GPU heightfield ripples, `webgl_gpgpu_water`).
- GPU particles via TSL compute for >10k particles (WebGPU only).
- Real fluids (MLS-MPM on WebGPU compute), as a visual-only, WebGPU-required feature.
- Soft bodies and cloth. This would need a second engine or a custom XPBD solver.
- Volumetric fire/smoke (raymarched noise).
- A visual particle curve/gradient editor. M3 uses numeric/list fields in the Inspector.

## Risks

- **Particle alpha on WebGPU.** Needs a node material path. If this proves fiddly, fall back to `SpriteNodeMaterial` with instanced attributes, as `webgpu_compute_particles` does, keeping the same `createParticleMaterial` interface.
- **Water cost.** The reflection pass renders the scene twice. It is disabled on `low`, and reflections skip particles and other water.
- **Buoyancy approximation.** Uses the AABB fraction, not the true submerged volume. This is fine for crates and barrels, but rotated long shapes will bob less realistically.
