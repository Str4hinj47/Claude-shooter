import * as THREE from "three";
import { clamp, smoothstep } from "../../character/math";

export type DeathStyle = "back" | "front" | "side";

export interface CorpseBoneRig {
  model: THREE.Object3D;
  bones: Record<string, THREE.Object3D>;
  bindQ: Record<string, THREE.Quaternion>;
  bindHipsPos: THREE.Vector3;
}

const BONE_KEYS = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
] as const;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function extractCorpseBoneRig(model: THREE.Object3D): CorpseBoneRig {
  const bones: Record<string, THREE.Object3D> = {};
  const bindQ: Record<string, THREE.Quaternion> = {};
  const bindHipsPos = new THREE.Vector3();

  model.traverse((o) => {
    if (/^mixamorig/.test(o.name)) {
      const key = o.name.replace(/^mixamorig:?/, "");
      if ((BONE_KEYS as readonly string[]).includes(key)) {
        bones[key] = o;
        bindQ[key] = o.quaternion.clone();
      }
    }
  });
  if (bones.Hips) {
    bindHipsPos.copy(bones.Hips.position);
  }
  return { model, bones, bindQ, bindHipsPos };
}

function setBoneOffset(rig: CorpseBoneRig, name: string, rx: number, ry: number, rz: number) {
  const b = rig.bones[name];
  const bq = rig.bindQ[name];
  if (!b || !bq) return;
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  b.quaternion.copy(bq).multiply(_q);
}

/**
 * Multi-phase procedural dying animation over Rocketbox `mixamorig*` bones:
 * 0.00 - 0.35s: bullet impact stagger, knee buckle, torso snap & arm fling
 * 0.35 - 0.95s: gravitational collapse onto pavement with settle bounce & splayed limbs
 */
export function applyProceduralDeathPose(
  rig: CorpseBoneRig,
  deathT: number,
  style: DeathStyle,
): { pitch: number; roll: number; yDrop: number; zSlide: number } {
  const stagger = smoothstep(0, 0.32, deathT);
  const fallRaw = clamp((deathT - 0.14) / 0.68, 0, 1);
  // Gravity-accelerated fall with subtle ground-hit bounce
  let fall = fallRaw * fallRaw;
  if (fallRaw > 0.86) {
    const b = (fallRaw - 0.86) / 0.14;
    fall -= Math.sin(b * Math.PI) * 0.06;
  }
  const settle = smoothstep(0.55, 1.05, deathT);

  const backSign = style === "front" ? 1 : -1;
  const sideSign = style === "side" ? 1 : 0;

  // 1. Knees buckle early, then relax slightly on pavement
  const kneeBend = stagger * 1.05 * (1 - settle * 0.55);
  setBoneOffset(rig, "LeftUpLeg", -kneeBend * 0.55, 0.12 * settle, 0.08 * settle);
  setBoneOffset(rig, "LeftLeg", kneeBend * 1.15, 0, 0);
  setBoneOffset(rig, "RightUpLeg", -kneeBend * 0.42, -0.18 * settle, -0.12 * settle);
  setBoneOffset(rig, "RightLeg", kneeBend * 0.92 + 0.25 * settle, 0, 0);

  // 2. Torso arches on impact, then curls slightly as body hits ground
  const spineArch = backSign * (stagger * 0.28 - settle * 0.14);
  const spineTwist = sideSign * 0.22 * settle + backSign * 0.12 * settle;
  setBoneOffset(rig, "Spine", spineArch, spineTwist, sideSign * 0.15);
  setBoneOffset(rig, "Spine1", spineArch * 0.85, spineTwist * 0.6, 0);
  setBoneOffset(rig, "Spine2", spineArch * 0.6, 0, 0);

  // 3. Head snaps back/down on impact, then lolls sideways on pavement
  setBoneOffset(
    rig,
    "Head",
    backSign * stagger * 0.45 - settle * 0.18,
    0.42 * settle * (backSign > 0 ? 1 : -1),
    0.28 * settle,
  );
  setBoneOffset(rig, "Neck", backSign * 0.18 * stagger, 0.15 * settle, 0);

  // 4. Arms fling outward from shoulder during fall, then rest splayed unevenly
  const armFling = stagger * 0.7 + settle * 0.45;
  setBoneOffset(rig, "LeftArm", -0.35 * settle, 0.28 * settle, 0.55 + armFling * 0.55);
  setBoneOffset(rig, "LeftForeArm", -0.55 * stagger - 0.35 * settle, 0, 0.2 * settle);
  setBoneOffset(rig, "RightArm", -0.22 * settle, -0.35 * settle, -0.5 - armFling * 0.48);
  setBoneOffset(rig, "RightForeArm", -0.45 * stagger - 0.52 * settle, 0, -0.18 * settle);

  if (rig.bones.Hips) {
    rig.bones.Hips.position.copy(rig.bindHipsPos);
    rig.bones.Hips.position.y -= stagger * 0.18 * (1 - settle);
  }

  const maxAngle = Math.PI * 0.485;
  return {
    pitch: backSign * fall * maxAngle,
    roll: sideSign * fall * 0.42,
    yDrop: 0.11 * Math.sin(fall * maxAngle),
    zSlide: backSign * 0.34 * fall,
  };
}

/**
 * Physical fireman's carry pose with inertia-driven dangling limb & head sway.
 * Body is draped over the carrier's right shoulder (head/arms hanging down behind,
 * legs hanging forward/down over the carrier's right chest/arm).
 */
export function applyCarriedCorpsePose(
  rig: CorpseBoneRig,
  swayX: number,
  swayZ: number,
  bounceY: number,
  time: number,
): void {
  if (rig.bones.Hips) {
    rig.bones.Hips.position.copy(rig.bindHipsPos);
  }
  const limps = Math.sin(time * 3.1) * 0.04;
  // Fold torso sharply over shoulder (jackknife drape)
  setBoneOffset(rig, "Spine", 0.46 + swayZ * 0.25, swayX * 0.18, swayX * 0.12);
  setBoneOffset(rig, "Spine1", 0.38 + swayZ * 0.22, swayX * 0.12, 0);
  setBoneOffset(rig, "Spine2", 0.28 + bounceY * 0.35, 0, 0);

  // Dangling head lolls heavily with player motion
  setBoneOffset(
    rig,
    "Neck",
    0.34 + swayZ * 0.4,
    swayX * 0.32,
    0.15 + swayX * 0.25,
  );
  setBoneOffset(
    rig,
    "Head",
    0.42 + swayZ * 0.55 + bounceY * 0.45,
    swayX * 0.42,
    0.22 + swayX * 0.3 + limps,
  );

  // Arms dangle downward behind the carrier's back and swing like pendulums
  setBoneOffset(rig, "LeftArm", 1.15 + swayZ * 0.72 + limps, 0.12, 0.24 + swayX * 0.45);
  setBoneOffset(rig, "LeftForeArm", 0.35 + swayZ * 0.55 + Math.abs(bounceY) * 0.4, 0, 0.1 + swayX * 0.25);
  setBoneOffset(rig, "RightArm", 1.08 + swayZ * 0.68 - limps, -0.15, -0.22 + swayX * 0.45);
  setBoneOffset(rig, "RightForeArm", 0.42 + swayZ * 0.5 + Math.abs(bounceY) * 0.4, 0, -0.08 + swayX * 0.25);

  // Thighs & shins drape over the front of the shoulder and sway with stride inertia
  setBoneOffset(rig, "LeftUpLeg", -0.82 - swayZ * 0.32, 0.08, 0.08 + swayX * 0.22);
  setBoneOffset(rig, "LeftLeg", 1.12 + swayZ * 0.52 + bounceY * 0.5, 0, swayX * 0.18);
  setBoneOffset(rig, "RightUpLeg", -0.76 - swayZ * 0.3, -0.08, -0.08 + swayX * 0.22);
  setBoneOffset(rig, "RightLeg", 1.04 + swayZ * 0.48 + bounceY * 0.45, 0, swayX * 0.18);
}

/** Relaxed horizontal deck pose for a body carried onto a boat */
export function applyBoatDeckPose(rig: CorpseBoneRig, time: number): void {
  if (rig.bones.Hips) {
    rig.bones.Hips.position.copy(rig.bindHipsPos);
  }
  const waveShift = Math.sin(time * 2.1) * 0.03;
  setBoneOffset(rig, "Spine", 0.08, 0.1, 0.04);
  setBoneOffset(rig, "Spine1", 0.06, 0.05, 0);
  setBoneOffset(rig, "Spine2", 0.05, 0, 0);
  setBoneOffset(rig, "Neck", -0.08, 0.22, 0.1);
  setBoneOffset(rig, "Head", -0.1, 0.35 + waveShift, 0.2);
  setBoneOffset(rig, "LeftArm", -0.12, 0.18, 0.72 + waveShift);
  setBoneOffset(rig, "LeftForeArm", -0.45, 0, 0.18);
  setBoneOffset(rig, "RightArm", -0.15, -0.22, -0.68 - waveShift);
  setBoneOffset(rig, "RightForeArm", -0.38, 0, -0.14);
  setBoneOffset(rig, "LeftUpLeg", -0.14, 0.1, 0.08);
  setBoneOffset(rig, "LeftLeg", 0.28, 0, 0);
  setBoneOffset(rig, "RightUpLeg", -0.22, -0.12, -0.08);
  setBoneOffset(rig, "RightLeg", 0.42, 0, 0);
}
