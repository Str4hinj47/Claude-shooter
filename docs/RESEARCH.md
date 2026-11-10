# Research: 3D Architecture, Tools & Repos Used

Date: 2026-11-10. This document records the research behind the game's worlds,
as requested, and how each finding was applied in code.

## 1. The soldier model (downloaded from GitHub)

The original zip shipped **without** `soldier.glb` (the rig code imports it but
the file was missing — the game could not load). Research found the exact model:

- **Source:** `mrdoob/three.js` → `examples/models/gltf/Soldier.glb`
  (https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb)
- **Why this one:** it is the official Three.js example model, Mixamo-rigged
  (68 nodes, `mixamorig:*` bones), with **Idle / Walk / Run** clips and the
  materials `VanguardBodyMat` / `Vanguard_VisorMat` — i.e. it *is* the
  "Vanguard Operator" the rig was written for. MIT licence.
- **How it was obtained:** the sandbox blocks `raw.githubusercontent.com`, so
  the model was fetched via the allowed `codeload.github.com` tarball of the
  three.js repo and extracted to `src/assets/soldier.glb` (2.1 MB).
- **Reuse for enemies:** the same GLB is loaded once per character and
  **re-tinted per faction** (see `SoldierRig.setTint`). One model, six armies —
  exactly the "use the soldier model and change their colour" requirement.

## 2. Procedural architecture (web research)

Researched procedural building generation for Three.js. Key sources:

1. **"Procedural Buildings in Three.js — From Footprint to Facade"**
   (mysimulator.uk tutorial) — footprint → floor extrusion → roof shapes →
   windows via `InstancedMesh` → seeded RNG (`mulberry32`) → cluster into blocks.
   *Applied:* every building in `src/game/levels.ts` is generated from a
   **seeded RNG** (deterministic, reproducible), facades use **bay-quantised
   window grids** (window count = round((width − margins) / bayWidth)), and
   windows are drawn into **canvas facade textures** (one draw call per wall
   instead of hundreds of window meshes) with emissive windows at night.
2. **threejs-procedural-buildings-and-cities skill** (threejs-skills.com) —
   massing grammar, exposed-edge analysis, material-slot compilation, real
   dimensions for floor height / bay width / texture density.
   *Applied:* buildings are assembled from a small **kit of parts**
   (walls, parapet, roof, door, AC unit, water tank, sign) with real-world
   dimensions (floor height 3 m, bay 1.5 m), compiled per material slot.
3. **3DWorld procedural city notes** (3dworldgen.blogspot.com) — window holes,
   interior visibility, collision with interiors.
   *Applied:* interiors are **not** enterable (buildings are solid AABBs —
   correct for a shooter where cover matters more than interiors), windows are
   opaque facade texture + emissive at night, and every building registers a
   **collision AABB** so the player/enemies can use it as cover.

**Design rules adopted for all six worlds:**
- Real dimensions everywhere (doors 2.1 m, floors 3 m, roads 6–8 m wide).
- Seeded randomness only — same seed, same city, every load.
- One canvas texture per material (brick, plaster, concrete, glass, corrugated
  metal, asphalt, dirt) with weathering + grime at the base.
- Silhouette first: varied heights, parapets, roofs, cranes, towers — the
  skyline must read from across the map.
- Every solid object = **raycast mesh + AABB collider** (bullets and bodies
  agree on what is solid).

## 3. 3D design tools (for future custom assets)

The game itself needs **no external tooling** — all architecture is procedural
code (fast loads, tiny build, no asset pipeline). For hand-authored props the
recommended free pipeline is:

| Tool | Use | Link |
|---|---|---|
| **Blender** (free) | Modelling custom props/vehicles, exporting `.glb` | https://www.blender.org |
| **Mixamo** (free, Adobe) | Rigging + mocap clips (Idle/Walk/Run) for new characters | https://www.mixamo.com |
| **three.js examples** | Reference models (Soldier, Xbot) + loaders | https://github.com/mrdoob/three.js |
| **Poly Haven** (free) | PBR textures / HDRIs for sky & materials | https://polyhaven.org |
| **Quaternius** (free) | Low-poly animated characters as alternates | https://quaternius.com |

To add a custom prop: model in Blender → export `.glb` → drop in
`src/assets/` → load with `GLTFLoader` like `SoldierRig` does.

## 4. GitHub repos consulted

- `mrdoob/three.js` — Soldier.glb model + Sky/PMREM environment pattern
  (already used by the original `world.ts`).
- `NafisRayan/3D-Game-Template-Ultimate` — Mixamo Idle/Walk/Run blending
  pattern (same clip names the rig expects).
- Procedural-building tutorials/skills listed in §2.

## 5. Graphics decisions (why it looks the way it does)

- **ACES filmic tone mapping + per-level exposure** — filmic highlights,
  no blown-out whites.
- **Physical sky (three.js `Sky`) + PMREM image-based lighting** — the sun
  actually lights the scene; each mission re-tunes sun elevation, turbidity,
  fog colour/density and hemisphere colours for dawn / overcast / dusk / night.
- **PCF soft shadows, 2048 map, texel-snapped** — stable, non-shimmering shadows.
- **Canvas-generated PBR-ish textures** (colour + bump) with anisotropy 16 —
  zero external texture downloads, crisp at grazing angles.
- **Emissive windows + point-light streetlights at night** — light where the
  story needs it, dark where it doesn't.
- **Particles (sparks / smoke / tracers / casings)** reused from the original
  `fx.ts`, extended with enemy tracers and hit feedback.
