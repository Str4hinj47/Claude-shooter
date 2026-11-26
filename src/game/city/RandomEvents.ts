import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { dampAngle } from "../../character/math";
import { characterUrl } from "../characters";
import { loadCachedSoldierGltf, upgradeCharacterMaterial } from "../../character/SoldierRig";
import type { ModelLibrary } from "../vehicles/ModelLibrary";
import { fitGlbToDimension, loadCityGlb } from "./PropModels";
import type { TerrainHeightFn } from "./HeightSystem";

function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cloned = clip.clone();
  cloned.tracks = cloned.tracks.filter((t) => !/Hips\.position/i.test(t.name));
  return cloned;
}

export type RandomEventKind = "purse_snatcher" | "armored_truck" | "street_brawl";

export interface RandomEventOutcome {
  title: string;
  detail: string;
  reward: number;
  crime?: "robbery" | "assault";
}

export interface ActiveRandomEvent {
  kind: RandomEventKind;
  title: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  ttl: number;
  group: THREE.Group;
  ring: THREE.Mesh;
  mixer: THREE.AnimationMixer | null;
}

/**
 * Spawns emergent GTA-style street encounters around Westgate Bay:
 * Purse Snatchers, Armored Van Cash Drops, and Street Ambush Chases.
 */
export class RandomEventsManager {
  readonly group = new THREE.Group();
  active: ActiveRandomEvent | null = null;
  private cooldown = 24;
  private animT = 0;
  private readonly terrainAt: TerrainHeightFn;
  private readonly groundAt: (x: number, z: number, maxY: number) => number;
  private readonly modelLibrary: ModelLibrary | null;
  private readonly isBrowser = typeof window !== "undefined" && typeof fetch === "function";

  constructor(
    terrainAt: TerrainHeightFn,
    groundAt: (x: number, z: number, maxY: number) => number,
    modelLibrary: ModelLibrary | null = null,
  ) {
    this.group.name = "westgate-random-events";
    this.terrainAt = terrainAt;
    this.groundAt = groundAt;
    this.modelLibrary = modelLibrary;
  }

  private buildEventVisual(kind: RandomEventKind): { group: THREE.Group; visual: THREE.Group; ring: THREE.Mesh } {
    const g = new THREE.Group();
    const visual = new THREE.Group();
    const ringCol = kind === "armored_truck" ? 0xfbbf24 : kind === "purse_snatcher" ? 0x38bdf8 : 0xf43f5e;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.85, 24),
      new THREE.MeshBasicMaterial({ color: ringCol, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.y = 0.12;
    g.add(ring, visual);

    if (kind === "armored_truck") {
      const vanMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.65 });
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xd97706, emissiveIntensity: 1.4 });
      const van = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 5.2), vanMat);
      van.position.y = 1.1;
      van.castShadow = true;
      const caseBox = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.52), goldMat);
      caseBox.position.set(1.85, 0.25, 0.8);
      visual.add(van, caseBox);
    } else {
      const shirtMat = new THREE.MeshStandardMaterial({
        color: kind === "purse_snatcher" ? 0xdc2626 : 0xf97316,
        roughness: 0.7,
      });
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xd6a482, roughness: 0.65 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.92, 10), shirtMat);
      body.position.y = 1.05;
      body.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), skinMat);
      head.position.y = 1.66;
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.28, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.1 }),
      );
      bag.position.set(0.26, 0.95, 0.15);
      visual.add(body, head, bag);
    }
    return { group: g, visual, ring };
  }

  private upgradeEventAssets(ev: ActiveRandomEvent, visual: THREE.Group): void {
    if (!this.isBrowser) return;

    if (ev.kind === "armored_truck") {
      if (this.modelLibrary) {
        const lib = this.modelLibrary;
        void lib.loadModel("kraz").then((loaded) => {
          if (!loaded || this.active !== ev) return;
          const truck = lib.create("kraz", { paint: 0x1e293b });
          if (!truck) return;
          truck.rotation.y = Math.PI;
          visual.clear();
          visual.add(truck);

          void loadCityGlb("stash_bag.glb").then((bagScene) => {
            if (!bagScene || this.active !== ev) return;
            const fittedBag = fitGlbToDimension(bagScene, "x", 0.65, 0.05);
            fittedBag.position.set(2.05, 0, 0.9);
            visual.add(fittedBag);
          });
        });
      }
      return;
    }

    const role = ev.kind === "purse_snatcher" ? "sports" : "construction";
    void loadCachedSoldierGltf(characterUrl(role))
      .then((gltf) => {
        if (this.active !== ev) return;
        const cloned = SkeletonUtils.clone(gltf.scene) as THREE.Group;
        cloned.rotation.y = Math.PI;
        cloned.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.userData.sharedGltfAsset = true;
          const orig = Array.isArray(m.material) ? m.material : [m.material];
          const up = orig.map((mat) => upgradeCharacterMaterial(mat));
          m.material = Array.isArray(m.material) ? up : up[0];
        });
        cloned.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(cloned);
        const h = box.max.y - box.min.y;
        if (h > 0.2) cloned.scale.multiplyScalar(1.8 / h);

        const mixer = new THREE.AnimationMixer(cloned);
        const clipName = ev.kind === "purse_snatcher" ? "Run" : "Walk";
        const clip =
          gltf.animations.find((a) => a.name === clipName) ??
          gltf.animations.find((a) => a.name.toLowerCase().includes(clipName.toLowerCase())) ??
          gltf.animations[0];
        if (clip) {
          const act = mixer.clipAction(stripRootMotion(clip));
          act.setLoop(THREE.LoopRepeat, Infinity);
          act.timeScale = ev.kind === "purse_snatcher" ? 1.15 : 1.0;
          act.play();
        }

        visual.clear();
        visual.add(cloned);
        ev.mixer = mixer;

        if (ev.kind === "purse_snatcher") {
          void loadCityGlb("stash_bag.glb").then((bagScene) => {
            if (!bagScene || this.active !== ev) return;
            const fittedBag = fitGlbToDimension(bagScene, "x", 0.42, 0.88);
            fittedBag.position.set(0.32, 0, 0.14);
            visual.add(fittedBag);
          });
        }
      })
      .catch(() => {});
  }

  private spawnNear(px: number, pz: number): ActiveRandomEvent | null {
    const ang = Math.random() * Math.PI * 2;
    const dist = 48 + Math.random() * 26;
    const x = px + Math.cos(ang) * dist;
    const z = pz + Math.sin(ang) * dist;
    const ty = this.terrainAt(x, z);
    const y = this.groundAt(x, z, ty + 2);
    if (y < 2.2) return null;

    const kinds: RandomEventKind[] = ["purse_snatcher", "armored_truck", "street_brawl"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const { group, visual, ring } = this.buildEventVisual(kind);
    const yaw = Math.atan2(x - px, z - pz);
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    this.group.add(group);

    const title =
      kind === "purse_snatcher"
        ? "Street Mugger Fleeing!"
        : kind === "armored_truck"
          ? "Armored Van Cash Drop"
          : "Street Ambush Alert";

    const ev: ActiveRandomEvent = { kind, title, x, y, z, yaw, hp: 50, ttl: 55, group, ring, mixer: null };
    this.active = ev;
    this.upgradeEventAssets(ev, visual);
    return ev;
  }

  clearActive(): void {
    if (!this.active) return;
    this.group.remove(this.active.group);
    this.active = null;
    this.cooldown = 36 + Math.random() * 22;
  }

  hitAtPoint(x: number, y: number, z: number, damage = 35): RandomEventOutcome | null {
    const ev = this.active;
    if (!ev || ev.kind === "armored_truck") return null;
    if (y < ev.y - 0.2 || y > ev.y + 2.0) return null;
    if (Math.hypot(x - ev.x, z - ev.z) > 0.9) return null;
    ev.hp -= damage;
    if (ev.hp <= 0) {
      const kind = ev.kind;
      this.clearActive();
      return {
        title: kind === "purse_snatcher" ? "Snatcher Stopped!" : "Ambush Cleared!",
        detail: "Good Samaritan reward collected",
        reward: kind === "purse_snatcher" ? 320 : 280,
      };
    }
    return null;
  }

  update(
    dt: number,
    playerPos: { x: number; y: number; z: number },
    driving: boolean,
  ): { spawned?: ActiveRandomEvent; outcome?: RandomEventOutcome } {
    this.animT += dt;
    if (!this.active) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        const spawned = this.spawnNear(playerPos.x, playerPos.z);
        if (spawned) return { spawned };
        this.cooldown = 10;
      }
      return {};
    }

    const ev = this.active;
    ev.ttl -= dt;
    const pulse = 1 + Math.sin(this.animT * 6) * 0.14;
    ev.ring.scale.set(pulse, pulse, 1);

    const dist = Math.hypot(playerPos.x - ev.x, playerPos.z - ev.z);
    if (ev.ttl <= 0 || dist > 165) {
      this.clearActive();
      return {};
    }

    // Fleeing runner behavior for purse_snatcher / street_brawl
    if (ev.kind !== "armored_truck") {
      const awayYaw = Math.atan2(ev.x - playerPos.x, ev.z - playerPos.z);
      ev.yaw = dampAngle(ev.yaw, awayYaw, 4.5, dt);
      const spd = ev.kind === "purse_snatcher" ? 4.4 : 2.8;
      const nx = ev.x + Math.sin(ev.yaw) * spd * dt;
      const nz = ev.z + Math.cos(ev.yaw) * spd * dt;
      const gy = this.groundAt(nx, nz, ev.y + 1.8);
      if (gy >= 2.0) {
        ev.x = nx;
        ev.y = gy;
        ev.z = nz;
      }
      ev.group.position.set(ev.x, ev.y, ev.z);
      ev.group.rotation.y = ev.yaw;
      ev.mixer?.update(dt);
    }

    // Intercept / pickup check
    const grabDist = ev.kind === "armored_truck" ? 3.2 : driving ? 2.6 : 1.7;
    if (dist <= grabDist && Math.abs(playerPos.y - ev.y) < 2.6) {
      const kind = ev.kind;
      this.clearActive();
      if (kind === "armored_truck") {
        return {
          outcome: {
            title: "Armored Cash Grabbed!",
            detail: "Security alarm triggered — Police alerted!",
            reward: 650,
            crime: "robbery",
          },
        };
      }
      return {
        outcome: {
          title: kind === "purse_snatcher" ? "Bag Recovered!" : "Street Brawl Broken Up!",
          detail: "Good Samaritan payout",
          reward: kind === "purse_snatcher" ? 320 : 280,
        },
      };
    }
    return {};
  }

  getActiveBlip(): { x: number; z: number; kind: RandomEventKind; title: string } | null {
    if (!this.active) return null;
    return { x: this.active.x, z: this.active.z, kind: this.active.kind, title: this.active.title };
  }
}
