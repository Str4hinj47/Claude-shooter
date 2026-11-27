import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { characterUrl } from "../characters";
import { loadCachedSoldierGltf, upgradeCharacterMaterial } from "../../character/SoldierRig";
import { registerNightGlowMaterial } from "./CityBuildingKit";
import { attachGlbToGroup } from "./PropModels";
import { bakeBoxMetricUv, materialFor } from "../kit/surface";

function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cloned = clip.clone();
  cloned.tracks = cloned.tracks.filter((t) => !/Hips\.position/i.test(t.name));
  return cloned;
}

export interface ModGarageDef {
  id: string;
  name: string;
  x: number;
  z: number;
  yawDeg: number;
}

export interface ConvenienceStoreDef {
  id: string;
  name: string;
  x: number;
  z: number;
  yawDeg: number;
}

export const WESTGATE_MOD_GARAGES: ModGarageDef[] = [
  { id: "garage_downtown", name: "Westgate Customs — Downtown", x: 112, z: -135, yawDeg: 180 },
  { id: "garage_delsol", name: "Westgate Customs — Del Sol", x: -640, z: 75, yawDeg: 90 },
  { id: "garage_midtown", name: "Westgate Customs — Midtown", x: -350, z: -165, yawDeg: 0 },
  { id: "garage_seaport", name: "Westgate Customs — Seaport", x: 615, z: 345, yawDeg: 270 },
];

/** Player distance (m) at which a 24/7 Mart clerk's skinned GLB is streamed in. */
const CLERK_HYDRATE_RADIUS = 95;

export const WESTGATE_STORES: ConvenienceStoreDef[] = [
  { id: "store_downtown", name: "24/7 Westgate Mart — Civic", x: -38, z: -125, yawDeg: 0 },
  { id: "store_delsol", name: "24/7 Westgate Mart — Boardwalk", x: -692, z: -72, yawDeg: 90 },
  { id: "store_oldquarter", name: "24/7 Westgate Mart — Old Quarter", x: 355, z: -160, yawDeg: 180 },
  { id: "store_mirror", name: "24/7 Westgate Mart — Mirror Park", x: -162, z: 295, yawDeg: 270 },
];

const CUSTOMS_PAINTS: Array<{ name: string; hex: number }> = [
  { name: "Obsidian Black", hex: 0x18181b },
  { name: "Midnight Cobalt", hex: 0x1d4ed8 },
  { name: "Crimson Corsa", hex: 0xdc2626 },
  { name: "Solar Amber", hex: 0xf59e0b },
  { name: "Emerald Venom", hex: 0x10b981 },
  { name: "Pearl Glacier", hex: 0xf1f5f9 },
  { name: "Violet Dusk", hex: 0x7c3aed },
];

export class CityShopsManager {
  readonly root = new THREE.Group();
  readonly colliders: THREE.Object3D[] = [];
  readonly garages: Array<{ def: ModGarageDef; pos: THREE.Vector3; ring: THREE.Mesh }> = [];
  readonly stores: Array<{
    def: ConvenienceStoreDef;
    pos: THREE.Vector3;
    counterPos: THREE.Vector3;
    robCooldown: number;
    clerkMesh: THREE.Group;
    mixer: THREE.AnimationMixer | null;
    /** Roles cycled per store — used when the clerk GLB is hydrated lazily. */
    clerkRole: string;
    /** Distant 24/7 marts hydrate their SkinnedMesh clerk only when the player
     *  comes within {@link CLERK_HYDRATE_RADIUS}; caps live skinned instances. */
    clerkHydrated: boolean;
    /** True while the clerk GLB request is in flight (prevents duplicate loads). */
    clerkHydrating: boolean;
  }> = [];

  private paintCursor = 0;
  private readonly isBrowser = typeof window !== "undefined" && typeof fetch === "function";

  constructor(terrainAt: (x: number, z: number) => number) {
    this.root.name = "westgate-city-shops";

    const concreteMat = materialFor(0x475569, { roughness: 0.85, family: "concrete", seed: 650 });
    const bayWallMat = materialFor(0x283342, { roughness: 0.58, metalness: 0.35, family: "metal", seed: 651 });
    const trimSteelMat = materialFor(0x181f28, { roughness: 0.42, metalness: 0.72, family: "metal", seed: 652 });
    const neonPurple = registerNightGlowMaterial(
      new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x9333ea, emissiveIntensity: 0.45 }),
      0.45,
      3.4,
    );
    const neonGreen = registerNightGlowMaterial(
      new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.45 }),
      0.45,
      3.2,
    );
    const storeWallMat = materialFor(0xe2dbd0, { roughness: 0.78, family: "brick", seed: 653 });
    const stonePlinthMat = materialFor(0x64686e, { roughness: 0.86, family: "stone", seed: 654 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x93c5fd,
      roughness: 0.08,
      metalness: 0.65,
      transparent: true,
      opacity: 0.45,
    });
    const counterMat = materialFor(0x334155, { roughness: 0.5, family: "wood", seed: 655 });

    const lotMaxY = (cx: number, cz: number, hw: number, hd: number) => {
      let m = terrainAt(cx, cz);
      for (const sx of [-hw, hw]) {
        for (const sz of [-hd, hd]) {
          m = Math.max(m, terrainAt(cx + sx, cz + sz));
        }
      }
      return m;
    };

    // 1. Build 4 Westgate Customs Drive-In Mod Garages
    for (const gDef of WESTGATE_MOD_GARAGES) {
      const y = lotMaxY(gDef.x, gDef.z, 4.4, 5.4);
      const grp = new THREE.Group();
      grp.position.set(gDef.x, y, gDef.z);
      grp.rotation.y = THREE.MathUtils.degToRad(gDef.yawDeg);

      const floor = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.78, 10.6), concreteMat);
      floor.position.y = -0.27;
      floor.receiveShadow = true;
      grp.add(floor);

      const leftW = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(0.4, 4.4, 10.4), 0.4, 4.4, 10.4, 1.6, 1.6), bayWallMat);
      leftW.position.set(-4.0, 2.2, 0);
      leftW.castShadow = true;
      const rightW = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(0.4, 4.4, 10.4), 0.4, 4.4, 10.4, 1.6, 1.6), bayWallMat);
      rightW.position.set(4.0, 2.2, 0);
      rightW.castShadow = true;
      const backW = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(8.4, 4.4, 0.4), 8.4, 4.4, 0.4, 1.6, 1.6), bayWallMat);
      backW.position.set(0, 2.2, -5.1);
      backW.castShadow = true;
      const roof = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(8.8, 0.35, 11.0), 8.8, 0.35, 11.0, 1.6, 1.6), trimSteelMat);
      roof.position.set(0, 4.55, 0);
      roof.castShadow = true;

      // Exterior structural steel portal pilasters & roof parapet coping
      for (const px of [-4.1, 4.1]) {
        for (const pz of [-5.1, 0, 5.1]) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.7, 0.55), trimSteelMat);
          col.position.set(px, 2.35, pz);
          col.castShadow = true;
          grp.add(col);
        }
      }
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.16, 1.35), trimSteelMat);
      canopy.position.set(0, 3.85, 5.65);
      canopy.castShadow = true;
      grp.add(canopy);

      const signBar = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.45, 0.2), neonPurple);
      signBar.position.set(0, 4.18, 5.45);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.5, 2.95, 28),
        new THREE.MeshBasicMaterial({
          color: 0xa855f7,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
      );
      ring.rotation.x = -Math.PI * 0.5;
      ring.position.set(0, 0.16, 0);

      grp.add(leftW, rightW, backW, roof, signBar, ring);
      this.colliders.push(leftW, rightW, backW);
      this.root.add(grp);
      this.garages.push({ def: gDef, pos: new THREE.Vector3(gDef.x, y, gDef.z), ring });

      attachGlbToGroup(grp, "gas_can.glb", -3.1, 0.12, -4.1, { axis: "y", targetMeters: 0.72, yaw: 0.4 });
      attachGlbToGroup(grp, "store_shelf.glb", 2.4, 0.12, -4.25, { axis: "y", targetMeters: 2.35, yaw: 0 });
      attachGlbToGroup(grp, "traffic_cone.glb", -3.35, 0.12, 4.85, { axis: "y", targetMeters: 0.68 });
      attachGlbToGroup(grp, "traffic_cone.glb", 3.35, 0.12, 4.85, { axis: "y", targetMeters: 0.68 });
    }

    // 2. Build 4 Walkable 24/7 Westgate Mart Convenience Stores
    const clerkCloth = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.75 });
    const clerkSkin = new THREE.MeshStandardMaterial({ color: 0xd6a482, roughness: 0.65 });
    const clerkRoles: string[] = ["delivery", "civilian", "business", "delivery"];
    for (let idx = 0; idx < WESTGATE_STORES.length; idx++) {
      const sDef = WESTGATE_STORES[idx];
      const y = lotMaxY(sDef.x, sDef.z, 4.2, 3.7);
      const grp = new THREE.Group();
      grp.position.set(sDef.x, y, sDef.z);
      grp.rotation.y = THREE.MathUtils.degToRad(sDef.yawDeg);

      const floor = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.78, 7.2), concreteMat);
      floor.position.y = -0.25;
      floor.receiveShadow = true;
      grp.add(floor);

      const lw = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(0.35, 3.6, 7.0), 0.35, 3.6, 7.0, 1.6, 1.0), storeWallMat);
      lw.position.set(-3.9, 1.8, 0);
      lw.castShadow = true;
      lw.receiveShadow = true;
      const rw = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(0.35, 3.6, 7.0), 0.35, 3.6, 7.0, 1.6, 1.0), storeWallMat);
      rw.position.set(3.9, 1.8, 0);
      rw.castShadow = true;
      rw.receiveShadow = true;
      const bw = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(8.1, 3.6, 0.35), 8.1, 3.6, 0.35, 1.6, 1.0), storeWallMat);
      bw.position.set(0, 1.8, -3.4);
      bw.castShadow = true;
      bw.receiveShadow = true;
      const roof = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(8.7, 0.38, 7.7), 8.7, 0.38, 7.7, 1.8, 1.8), trimSteelMat);
      roof.position.set(0, 3.74, 0);
      roof.castShadow = true;
      const stoneKick = new THREE.Mesh(bakeBoxMetricUv(new THREE.BoxGeometry(8.3, 0.55, 7.2), 8.3, 0.55, 7.2, 1.6, 1.6), stonePlinthMat);
      stoneKick.position.set(0, 0.275, 0);
      grp.add(stoneKick);
      // Corner pilasters + front canopy & storefront mullions
      for (const px of [-3.95, -1.35, 1.35, 3.95]) {
        const mull = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.6, 0.24), trimSteelMat);
        mull.position.set(px, 1.8, 3.44);
        grp.add(mull);
      }
      const entryAwning = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.14, 1.25), trimSteelMat);
      entryAwning.position.set(0, 3.12, 4.0);
      entryAwning.castShadow = true;
      grp.add(entryAwning);

      // Front glass flanks with open center entrance (2.8m wide doorway)
      const fl = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.2, 0.15), glassMat);
      fl.position.set(-2.6, 1.6, 3.4);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.2, 0.15), glassMat);
      fr.position.set(2.6, 1.6, 3.4);
      const neonSign = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.42, 0.2), neonGreen);
      neonSign.position.set(0, 3.35, 3.58);

      // Interior counter + snack shelf + cash register + Kevlar rack + clerk
      const counter = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.05, 0.8), counterMat);
      counter.position.set(-1.1, 0.55, -1.6);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.1, 3.4), counterMat);
      shelf.position.set(2.6, 1.05, -0.4);
      const armorStand = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.72, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0369a1, emissiveIntensity: 0.45, roughness: 0.45 }),
      );
      armorStand.position.set(-2.35, 1.42, -1.6);

      const clerk = new THREE.Group();
      clerk.position.set(-1.1, 0.14, -2.55);
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.9, 10), clerkCloth);
      torso.position.y = 1.05;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), clerkSkin);
      head.position.y = 1.64;
      clerk.add(torso, head);

      grp.add(lw, rw, bw, roof, fl, fr, neonSign, counter, shelf, armorStand, clerk);
      this.colliders.push(lw, rw, bw, fl, fr, counter, shelf);
      this.root.add(grp);

      attachGlbToGroup(grp, "pos_terminal.glb", -0.15, 1.07, -1.6, { axis: "y", targetMeters: 0.55, yaw: Math.PI });
      attachGlbToGroup(grp, "store_shelf.glb", 2.6, 0.14, -0.4, {
        axis: "y",
        targetMeters: 2.25,
        yaw: Math.PI * 0.5,
        onAttached: () => {
          shelf.visible = false;
        },
      });
      attachGlbToGroup(grp, "trash_bin.glb", -3.35, 0.08, 4.1, { axis: "y", targetMeters: 0.98, yaw: 0.25 });

      const worldCounter = new THREE.Vector3(-1.1, 0, -1.0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(sDef.yawDeg))
        .add(new THREE.Vector3(sDef.x, y, sDef.z));

      const storeEntry = {
        def: sDef,
        pos: new THREE.Vector3(sDef.x, y, sDef.z),
        counterPos: worldCounter,
        robCooldown: 0,
        clerkMesh: clerk,
        mixer: null as THREE.AnimationMixer | null,
        clerkRole: clerkRoles[idx % clerkRoles.length],
        clerkHydrated: false,
        clerkHydrating: false,
      };
      this.stores.push(storeEntry);
    }
  }

  /**
   * Streams the SkinnedMesh clerk for one 24/7 Mart on demand.
   * Boot no longer builds four animated skinned characters up front, which used
   * to cost ~4 character GLB requests, 4 SkeletonUtils clones and 4
   * AnimationMixers before the first frame was ever presented.
   */
  private hydrateStoreClerk(store: CityShopsManager["stores"][number]): void {
    if (!this.isBrowser || store.clerkHydrated || store.clerkHydrating) return;
    store.clerkHydrating = true;
    const { clerkMesh, clerkRole } = store;
    void loadCachedSoldierGltf(characterUrl(clerkRole))
      .then((gltf) => {
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
        if (h > 0.2) cloned.scale.multiplyScalar(1.78 / h);

        const mixer = new THREE.AnimationMixer(cloned);
        const idleClip =
          gltf.animations.find((a) => a.name === "Idle") ??
          gltf.animations.find((a) => a.name.toLowerCase().includes("idle")) ??
          gltf.animations[0];
        if (idleClip) {
          const act = mixer.clipAction(stripRootMotion(idleClip));
          act.setLoop(THREE.LoopRepeat, Infinity);
          act.play();
          mixer.update(this.stores.indexOf(store) * 0.7);
        }

        clerkMesh.clear();
        clerkMesh.add(cloned);
        store.mixer = mixer;
        store.clerkHydrated = true;
      })
      .catch(() => {})
      .finally(() => {
        store.clerkHydrating = false;
      });
  }

  update(dt: number, focusPos?: THREE.Vector3): void {
    for (const s of this.stores) {
      if (s.robCooldown > 0) s.robCooldown = Math.max(0, s.robCooldown - dt);
      // Clerk cowers slightly while store is on robbery cooldown
      s.clerkMesh.position.y = s.robCooldown > 25 ? -0.35 : 0.14;

      // Phase 3 proximity hydration: only pull a clerk's skinned GLB in once the
      // player is actually near this mart. Without a focus position (headless /
      // tests) fall back to hydrating everyone so scenes stay complete.
      if (!s.clerkHydrated && !s.clerkHydrating) {
        if (!focusPos) {
          this.hydrateStoreClerk(s);
        } else {
          const d2 = (s.pos.x - focusPos.x) ** 2 + (s.pos.z - focusPos.z) ** 2;
          if (d2 < CLERK_HYDRATE_RADIUS * CLERK_HYDRATE_RADIUS) this.hydrateStoreClerk(s);
        }
      }

      if (s.mixer && (!focusPos || (s.pos.x - focusPos.x) ** 2 + (s.pos.z - focusPos.z) ** 2 < 90 * 90)) {
        s.mixer.update(dt);
      }
    }
  }

  findNearbyGarage(pos: THREE.Vector3, maxDist = 6.2): ModGarageDef | null {
    for (const g of this.garages) {
      if (Math.hypot(pos.x - g.pos.x, pos.z - g.pos.z) <= maxDist && Math.abs(pos.y - g.pos.y) < 4) {
        return g.def;
      }
    }
    return null;
  }

  findNearbyStore(pos: THREE.Vector3, maxDist = 5.4): { def: ConvenienceStoreDef; robbable: boolean; counterPos: THREE.Vector3 } | null {
    for (const s of this.stores) {
      if (Math.hypot(pos.x - s.pos.x, pos.z - s.pos.z) <= maxDist && Math.abs(pos.y - s.pos.y) < 3.5) {
        return { def: s.def, robbable: s.robCooldown <= 0, counterPos: s.counterPos };
      }
    }
    return null;
  }

  nextPaintOption(): { name: string; hex: number } {
    const p = CUSTOMS_PAINTS[this.paintCursor % CUSTOMS_PAINTS.length];
    this.paintCursor++;
    return p;
  }

  triggerRobbery(storeId: string): number {
    const s = this.stores.find((st) => st.def.id === storeId);
    if (!s || s.robCooldown > 0) return 0;
    s.robCooldown = 45;
    return 360 + Math.floor(Math.random() * 280);
  }

  getGarageSummaries(): { id: string; name: string; x: number; z: number }[] {
    return this.garages.map((g) => ({ id: g.def.id, name: g.def.name, x: g.pos.x, z: g.pos.z }));
  }

  getStoreSummaries(): { id: string; name: string; x: number; z: number }[] {
    return this.stores.map((s) => ({ id: s.def.id, name: s.def.name, x: s.pos.x, z: s.pos.z }));
  }
}
