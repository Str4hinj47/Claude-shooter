# Hand-to-Hand Combat Assets & Attribution

## Mixamo Combat Animation GLBs (`public/animations/combat/*.glb`)
- Sourced from GitHub repository [`MisterYI/deevid-mixamo-assets`](https://github.com/MisterYI/deevid-mixamo-assets) (`anim/*.glb`), originating from Adobe Mixamo (subject to Adobe Mixamo terms of use).
- Files included:
  - `fight_idle.glb` (`anim/Fight_Idle.glb`)
  - `jab.glb` (`anim/Lead_Jab.glb`)
  - `cross.glb` (`anim/Cross_Punch.glb`)
  - `hook.glb` (`anim/Hook_Punch.glb`)
  - `uppercut.glb` (`anim/Uppercut.glb`)
  - `kick.glb` (`anim/Standing_Melee_Attack_Kick_Ver._1.glb`)
  - `block.glb` (`anim/Inward_Block.glb`)
  - `dodge.glb` (`anim/Standing_Dodge_Left.glb`)
  - `hit.glb` (`anim/Hit_To_Body.glb`)
  - `knockdown.glb` (`anim/Knocked_Down.glb`)

## Architecture & Algorithm References
- World-space rest-pose humanoid skeleton retargeting approach informed by [`nirholas/three-ws-retarget`](https://github.com/nirholas/three-ws-retarget) (Apache-2.0).
- Frame-data-driven melee state machine (`startup`, `active`, `recovery`, `hitstun`, `blockstun`, combo cancel windows, hitstop, and chip/guard-break logic) informed by [`liyupi/niulai-game`](https://github.com/liyupi/niulai-game) (MIT).
