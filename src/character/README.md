# SoldierRig – drop-in animated soldier for a shooter

`SoldierRig.ts` loads `assets/soldier.glb` (Mixamo-rigged, 49 joints, 3 mocap clips: Idle / Walk / Run)
and layers a full procedural animation system on top:

| Layer | What it does |
| --- | --- |
| Locomotion | Idle/Walk/Run blended by speed. Stride length + phase of each clip are *measured at load* (foot contact velocity) so feet never skate, and walk/run cycles stay phase-locked. Backwards + strafing via leg-yaw + spine counter-twist. |
| Aim | Spine chain + head follow camera pitch/yaw, lean (Q/E), chest "bladed" for the shouldered rifle. |
| Arms | Analytic two-bone IK to the weapon grip points, wrist-twist redistribution onto the forearm, per-finger grip curl. |
| Weapon | Low-ready / aimed / sprint poses blended, spring-driven recoil + sway. |
| Reload | Keyframed left-hand sequence: mag out → drop (physics) → pouch → insert → charging handle. |
| Legs | Crouch, landing absorption and jump-tuck through leg IK with planted ankles. |
| Reactions | Directional hit flinch (springs), death falls (back / front) with knee buckle, arm flop, head loll, weapon drop. |

## Usage

```ts
const rig = await SoldierRig.load(scene);
rig.events = { onShot, onFootstep, onReloadEvent, ... };

// every frame
rig.input.move.set(x, 0, z);   // world-space direction (0..1)
rig.input.sprint = shift; rig.input.crouch = ctrl; rig.input.ads = rmb; rig.input.lean = -1..1;
rig.aimYaw = camYaw; rig.aimPitch = camPitch; rig.aimPoint.copy(rayHitPoint);
rig.update(dt);
if (mouseDown) rig.fire();

rig.jump(); rig.reload(); rig.hit(angle); rig.die('back' | 'front'); rig.respawn();
```
