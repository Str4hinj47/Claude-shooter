import * as THREE from "three";
import { craftedBarrel } from "../kit/geom";
import { fitGlbToDimension, loadCityGlb } from "./PropModels";

export interface PickupItem {
  id: string;
  kind: "stash" | "cash" | "medkit";
  x: number;
  y: number;
  z: number;
  value: number;
  mesh: THREE.Group;
  collected: boolean;
}

export interface ExplosiveProp {
  id: string;
  x: number;
  y: number;
  z: number;
  hp: number;
  exploded: boolean;
  mesh: THREE.Object3D;
}

export interface PickupResult {
  kind: "stash" | "cash" | "medkit";
  value: number;
  stashesFound: number;
  totalStashes: number;
}

const STASH_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [38, -165],    // Legion Square
  [185, 58],     // Police HQ Deck
  [-395, -95],   // Midtown Mall
  [-146, -206],  // St. Jude's Medical
  [-165, -332],  // University Clocktower
  [-115, 342],   // Mirror Central Park
  [-735, 36],    // Del Sol Pier end
  [-648, 164],   // Venice Canals
  [-120, -974],  // Observatory Summit
  [-220, -820],  // Vinewood Crest
  [265, -635],   // North Gorge Bridge
  [635, 432],    // Seaport Terminal
  [-415, 615],   // Sports Arena
  [-120, 850],   // South Airport
  [385, -56],    // Downtown Arch Bridge
];

const EXPLOSIVE_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-288, 344],  // Safehouse Crescent Street Corner (near spawn)
  [-292, 346],
  [-215, 275],  // Old Quarter Gas Station
  [-208, 275],
  [-206, 179],  // Old Quarter Compound Gate
  [-198, 179],
  [-455, 65],   // Midtown Construction Yard
  [-448, 65],
  [-430, -110], // Midtown Service Barrel
  [-424, -110],
  [-64, -385],  // Downtown Financial Plaza
  [-56, -385],
  [125, -145],  // Downtown Alley Tank
  [131, -145],
  [395, -116],  // East Downtown Plaza
  [403, -116],
  [585, 412],   // Seaport Fuel Tank
  [592, 412],
  [690, 462],   // Eastgate Seaport Docks
  [697, 462],
  [-85, 895],   // Airport Fuel Depot
  [-78, 895],
  [-675, -80],  // Del Sol Boardwalk Tank
  [-668, -80],
  [340, 265],   // East Industrial Depot
  [346, 265],
  [-495, -415], // North Foothills Citadel
  [-488, -415],
];

/**
 * Manages 15 Hidden Cash Stashes, dynamic Cash/Medkit drops,
 * and destructible Explosive Fuel Tanks across Westgate Bay.
 */
export class CollectiblesSystem {
  readonly group = new THREE.Group();
  readonly pickups: PickupItem[] = [];
  readonly explosives: ExplosiveProp[] = [];
  stashesFound = 0;
  readonly totalStashes = STASH_SPOTS.length;
  private animT = 0;
  private dropSeq = 1;
  private readonly terrainAt: (x: number, z: number) => number;
  private readonly groundAt: (x: number, z: number, maxY: number) => number;

  constructor(
    terrainAt: (x: number, z: number) => number,
    groundAt: (x: number, z: number, maxY: number) => number,
  ) {
    this.group.name = "westgate-collectibles";
    this.terrainAt = terrainAt;
    this.groundAt = groundAt;
    this.populateStatic();
  }

  private buildPickupMesh(kind: "stash" | "cash" | "medkit"): THREE.Group {
    const g = new THREE.Group();
    const col = kind === "stash" ? 0xfbbf24 : kind === "cash" ? 0x22c55e : 0x38bdf8;
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 1.35,
      roughness: 0.25,
      metalness: 0.45,
    });
    const geom =
      kind === "stash"
        ? new THREE.OctahedronGeometry(0.45, 0)
        : kind === "cash"
          ? new THREE.BoxGeometry(0.42, 0.2, 0.28)
          : new THREE.BoxGeometry(0.42, 0.34, 0.22);
    const core = new THREE.Mesh(geom, mat);
    core.position.y = 0.85;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 18),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.y = 0.08;
    g.add(core, ring);

    if (kind === "stash" || kind === "medkit") {
      const glbName = kind === "stash" ? "stash_bag.glb" : "medkit.glb";
      const dim = kind === "stash" ? 0.78 : 0.62;
      void loadCityGlb(glbName).then((scene) => {
        if (!scene) return;
        const fitted = fitGlbToDimension(scene, "max", dim, -dim * 0.25);
        fitted.position.y = 0.85;
        g.remove(core);
        g.add(fitted);
        g.children.reverse();
      });
    }
    return g;
  }

  private populateStatic(): void {
    STASH_SPOTS.forEach(([x, z], idx) => {
      const y = this.groundAt(x, z, this.terrainAt(x, z) + 8);
      const mesh = this.buildPickupMesh("stash");
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      this.pickups.push({
        id: `stash_${idx}`,
        kind: "stash",
        x,
        y,
        z,
        value: 500,
        mesh,
        collected: false,
      });
    });

    const hazardBandMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xca8a04,
      emissiveIntensity: 0.28,
      roughness: 0.42,
      metalness: 0.25,
    });
    const hazardBandGeo = new THREE.CylinderGeometry(0.41, 0.41, 0.14, 16, 1, true);
    EXPLOSIVE_SPOTS.forEach(([x, z], idx) => {
      const y = this.groundAt(x, z, this.terrainAt(x, z) + 4);
      const holder = new THREE.Group();
      holder.position.set(x, y, z);
      const barrel = craftedBarrel(0xdc2626, true);
      barrel.scale.setScalar(1.06);
      holder.add(barrel);
      const band = new THREE.Mesh(hazardBandGeo, hazardBandMat);
      band.position.y = 0.56;
      holder.add(band);
      this.group.add(holder);
      const prop: ExplosiveProp = {
        id: `exp_${idx}`,
        x,
        y,
        z,
        hp: 40,
        exploded: false,
        mesh: holder,
      };
      this.explosives.push(prop);
    });
  }

  spawnDrop(kind: "cash" | "medkit", x: number, y: number, z: number, value: number): void {
    const mesh = this.buildPickupMesh(kind);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.pickups.push({
      id: `drop_${this.dropSeq++}`,
      kind,
      x,
      y,
      z,
      value,
      mesh,
      collected: false,
    });
  }

  /** Exact ray-cylinder hit test against explosive red barrels so bullets never step past them. */
  hitExplosiveAlongRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    damage = 35,
  ): { point: THREE.Vector3; exploded: boolean; dist: number } | null {
    let bestE: ExplosiveProp | null = null;
    let bestT = maxDist;
    const hitPoint = new THREE.Vector3();
    for (let i = 0; i < this.explosives.length; i++) {
      const e = this.explosives[i];
      if (e.exploded) continue;
      // Quick XZ ray-sphere/cylinder projection
      const ocx = e.x - origin.x;
      const ocy = e.y + 0.58 - origin.y;
      const ocz = e.z - origin.z;
      const t = ocx * dir.x + ocy * dir.y + ocz * dir.z;
      if (t < 0 || t > bestT) continue;
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      if (py < e.y - 0.12 || py > e.y + 1.35) continue;
      const dx = px - e.x;
      const dz = pz - e.z;
      if (dx * dx + dz * dz <= 0.62 * 0.62) {
        bestT = t;
        bestE = e;
        hitPoint.set(px, py, pz);
      }
    }
    if (!bestE) return null;
    bestE.hp -= damage;
    if (bestE.hp <= 0) {
      bestE.exploded = true;
      bestE.mesh.visible = false;
      return { point: new THREE.Vector3(bestE.x, bestE.y + 0.55, bestE.z), exploded: true, dist: bestT };
    }
    return { point: hitPoint, exploded: false, dist: bestT };
  }

  /** Chain-detonates any unexploded barrels within radius of a blast. */
  detonateExplosivesNear(pos: THREE.Vector3, radius: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const r2 = radius * radius;
    for (let i = 0; i < this.explosives.length; i++) {
      const e = this.explosives[i];
      if (e.exploded) continue;
      const dx = e.x - pos.x;
      const dy = e.y + 0.55 - pos.y;
      const dz = e.z - pos.z;
      if (dx * dx + dy * dy + dz * dz <= r2) {
        e.hp = 0;
        e.exploded = true;
        e.mesh.visible = false;
        out.push(new THREE.Vector3(e.x, e.y + 0.55, e.z));
      }
    }
    return out;
  }

  /** Checks gunshot/impact damage against explosive fuel tanks; returns exploded positions. */
  hitExplosiveAtPoint(x: number, y: number, z: number, damage = 35): THREE.Vector3 | null {
    for (const e of this.explosives) {
      if (e.exploded) continue;
      if (y < e.y - 0.1 || y > e.y + 1.45) continue;
      if (Math.hypot(x - e.x, z - e.z) <= 0.72) {
        e.hp -= damage;
        if (e.hp <= 0) {
          e.exploded = true;
          e.mesh.visible = false;
          return new THREE.Vector3(e.x, e.y + 0.55, e.z);
        }
      }
    }
    return null;
  }

  /** Ramming an explosive fuel barrel with a speeding vehicle detonates it! */
  checkVehicleRamExplosives(pos: THREE.Vector3, speedMs: number): THREE.Vector3 | null {
    if (Math.abs(speedMs) < 5) return null;
    for (const e of this.explosives) {
      if (e.exploded) continue;
      if (Math.abs(pos.y - e.y) > 2.0) continue;
      if (Math.hypot(pos.x - e.x, pos.z - e.z) < 2.2) {
        e.exploded = true;
        e.mesh.visible = false;
        return new THREE.Vector3(e.x, e.y + 0.55, e.z);
      }
    }
    return null;
  }

  update(dt: number, playerPos: { x: number; y: number; z: number }): PickupResult | null {
    this.animT += dt;
    let picked: PickupResult | null = null;
    for (const p of this.pickups) {
      if (p.collected) continue;
      const core = p.mesh.children[0];
      if (core) {
        core.rotation.y = this.animT * 2.2;
        core.position.y = 0.85 + Math.sin(this.animT * 3.1 + p.x) * 0.12;
      }
      if (Math.abs(playerPos.y - p.y) > 2.6) continue;
      if (Math.hypot(playerPos.x - p.x, playerPos.z - p.z) < 2.15) {
        p.collected = true;
        p.mesh.visible = false;
        if (p.kind === "stash") this.stashesFound++;
        picked = {
          kind: p.kind,
          value: p.value,
          stashesFound: this.stashesFound,
          totalStashes: this.totalStashes,
        };
      }
    }
    return picked;
  }

  getStashBlips(): Array<{ x: number; z: number; collected: boolean }> {
    return this.pickups
      .filter((p) => p.kind === "stash")
      .map((p) => ({ x: p.x, z: p.z, collected: p.collected }));
  }
}
