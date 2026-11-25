import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadCityGltf } from "./PropModels";

interface WildlifeActor {
  kind: "dog" | "deer";
  group: THREE.Group;
  cx: number;
  cz: number;
  x: number;
  z: number;
  rx: number;
  rz: number;
  phase: number;
  speed: number;
  pauseTimer: number;
  moving: boolean;
  fleeTimer: number;
  fleeYaw: number;
  mixer: THREE.AnimationMixer | null;
  moveAction: THREE.AnimationAction | null;
  idleAction: THREE.AnimationAction | null;
}

export class WildlifeSystem {
  readonly root = new THREE.Group();
  private readonly actors: WildlifeActor[] = [];
  private readonly terrainAt: (x: number, z: number) => number;
  private readonly groundAt: (x: number, z: number, y: number) => number;
  private loaded = false;

  constructor(
    terrainAt: (x: number, z: number) => number,
    groundAt: (x: number, z: number, y: number) => number,
  ) {
    this.root.name = "westgate-wildlife";
    this.terrainAt = terrainAt;
    this.groundAt = groundAt;

    const defs: Array<{ kind: "dog" | "deer"; cx: number; cz: number; rx: number; rz: number; phase: number; speed: number }> = [
      // Mirror Central Park dogs
      { kind: "dog", cx: -115, cz: 392, rx: 14, rz: 10, phase: 0.4, speed: 0.24 },
      { kind: "dog", cx: -92, cz: 376, rx: 10, rz: 12, phase: 2.1, speed: 0.22 },
      // Venice Canals & University Quad dogs
      { kind: "dog", cx: -644, cz: 162, rx: 9, rz: 14, phase: 1.2, speed: 0.2 },
      { kind: "dog", cx: -162, cz: -358, rx: 12, rz: 9, phase: 3.4, speed: 0.22 },
      // Del Sol Boardwalk lawn dog
      { kind: "dog", cx: -662, cz: 38, rx: 11, rz: 15, phase: 4.5, speed: 0.23 },
      // Observatory Foothills & Vinewood Crest deer herd
      { kind: "deer", cx: -215, cz: -792, rx: 22, rz: 16, phase: 0.6, speed: 0.14 },
      { kind: "deer", cx: -180, cz: -825, rx: 18, rz: 20, phase: 2.4, speed: 0.13 },
      { kind: "deer", cx: -95, cz: -895, rx: 20, rz: 14, phase: 3.9, speed: 0.15 },
      { kind: "deer", cx: -265, cz: -765, rx: 16, rz: 18, phase: 5.1, speed: 0.14 },
    ];

    for (const d of defs) {
      const grp = new THREE.Group();
      const y = this.terrainAt(d.cx, d.cz);
      grp.position.set(d.cx, y, d.cz);
      this.root.add(grp);
      this.actors.push({
        kind: d.kind,
        group: grp,
        cx: d.cx,
        cz: d.cz,
        x: d.cx,
        z: d.cz,
        rx: d.rx,
        rz: d.rz,
        phase: d.phase,
        speed: d.speed,
        pauseTimer: (d.phase % 2.5) + 1.0,
        moving: true,
        fleeTimer: 0,
        fleeYaw: 0,
        mixer: null,
        moveAction: null,
        idleAction: null,
      });
    }

    if (typeof window !== "undefined" && typeof fetch === "function") {
      this.loadAssets();
    }
  }

  private loadAssets(): void {
    if (this.loaded) return;
    this.loaded = true;

    void Promise.all([loadCityGltf("dog_husky.glb"), loadCityGltf("deer.glb")]).then(([dogAsset, deerAsset]) => {
      for (const act of this.actors) {
        const src = act.kind === "dog" ? dogAsset : deerAsset;
        if (!src) continue;
        const clone = SkeletonUtils.clone(src.scene) as THREE.Group;
        clone.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(clone);
        const sz = box.getSize(new THREE.Vector3());
        const targetH = act.kind === "dog" ? 0.68 : 1.28;
        const sc = sz.y > 1e-4 ? targetH / sz.y : 1;
        clone.scale.setScalar(sc);
        clone.position.y = -box.min.y * sc;
        clone.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        act.group.add(clone);

        if (src.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(clone);
          const pick = (re: RegExp) => src.animations.find((c) => re.test(c.name));
          const moveClip = pick(/walk|gallop|run/i) ?? src.animations[0];
          const idleClip = pick(/eat|idle/i) ?? src.animations[0];
          act.moveAction = mixer.clipAction(moveClip);
          act.idleAction = mixer.clipAction(idleClip);
          act.moveAction.timeScale = act.kind === "dog" ? 0.9 : 0.72;
          act.moveAction.play();
          act.mixer = mixer;
        }
      }
    });
  }

  alertNear(x: number, z: number, radius = 26): void {
    const r2 = radius * radius;
    for (const act of this.actors) {
      const dx = act.x - x;
      const dz = act.z - z;
      if (dx * dx + dz * dz > r2) continue;
      act.fleeYaw = Math.atan2(dx, dz);
      act.fleeTimer = act.kind === "deer" ? 4.2 : 2.6;
      act.moving = true;
      if (act.mixer && act.moveAction && act.idleAction && act.moveAction !== act.idleAction) {
        act.idleAction.fadeOut(0.15);
        act.moveAction.reset().fadeIn(0.15).play();
      }
      if (act.moveAction) act.moveAction.timeScale = act.kind === "deer" ? 1.55 : 1.35;
    }
  }

  update(dt: number, focus: THREE.Vector3): void {
    const step = Math.min(dt, 0.05);
    const maxDist2 = 145 * 145;
    for (const act of this.actors) {
      const dx = act.group.position.x - focus.x;
      const dz = act.group.position.z - focus.z;
      const d2 = dx * dx + dz * dz;
      const near = d2 <= maxDist2;
      act.group.visible = near;
      if (!near) continue;

      if (d2 < 11 * 11 && act.fleeTimer <= 0) {
        act.fleeYaw = Math.atan2(dx, dz);
        act.fleeTimer = act.kind === "deer" ? 3.5 : 1.8;
        act.moving = true;
        if (act.mixer && act.moveAction && act.idleAction && act.moveAction !== act.idleAction) {
          act.idleAction.fadeOut(0.15);
          act.moveAction.reset().fadeIn(0.15).play();
        }
        if (act.moveAction) act.moveAction.timeScale = act.kind === "deer" ? 1.5 : 1.3;
      }

      if (act.fleeTimer > 0) {
        act.fleeTimer = Math.max(0, act.fleeTimer - step);
        const fleeSpd = act.kind === "deer" ? 5.6 : 4.2;
        const nx = act.x + Math.sin(act.fleeYaw) * fleeSpd * step;
        const nz = act.z + Math.cos(act.fleeYaw) * fleeSpd * step;
        const ty = this.terrainAt(nx, nz);
        const gy = this.groundAt(nx, nz, ty + 1.2);
        if (gy >= 1.5 && Math.hypot(nx - act.cx, nz - act.cz) < 65) {
          act.x = nx;
          act.z = nz;
          act.group.position.set(nx, gy, nz);
          act.group.rotation.y = act.fleeYaw;
        } else {
          act.fleeYaw += 1.8 * step;
        }
        if (act.fleeTimer === 0 && act.moveAction) {
          act.moveAction.timeScale = act.kind === "dog" ? 0.9 : 0.72;
        }
        act.mixer?.update(step);
        continue;
      }

      act.pauseTimer -= step;
      if (act.pauseTimer <= 0) {
        act.moving = !act.moving;
        act.pauseTimer = act.moving ? 4.5 + (act.phase % 3) : 2.2 + (act.phase % 2);
        if (act.mixer && act.moveAction && act.idleAction && act.moveAction !== act.idleAction) {
          if (act.moving) {
            act.idleAction.fadeOut(0.25);
            act.moveAction.reset().fadeIn(0.25).play();
          } else {
            act.moveAction.fadeOut(0.25);
            act.idleAction.reset().fadeIn(0.25).play();
          }
        }
      }

      if (act.moving) {
        act.phase += act.speed * step;
        const tx = act.cx + Math.cos(act.phase) * act.rx;
        const tz = act.cz + Math.sin(act.phase * 1.15) * act.rz;
        const lerpRate = 1 - Math.exp(-3.2 * step);
        const nx = act.x + (tx - act.x) * lerpRate;
        const nz = act.z + (tz - act.z) * lerpRate;
        const vx = nx - act.x;
        const vz = nz - act.z;
        act.x = nx;
        act.z = nz;
        const ty = this.terrainAt(nx, nz);
        const gy = this.groundAt(nx, nz, ty + 1.0);
        act.group.position.set(nx, gy, nz);
        if (vx * vx + vz * vz > 1e-6) {
          act.group.rotation.y = Math.atan2(vx, vz);
        }
      }
      act.mixer?.update(step);
    }
  }
}
