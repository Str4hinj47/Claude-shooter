import * as THREE from "three";
import { fitGlbToDimension, loadCityGlb, loadCityGltf } from "./PropModels";

interface BirdAgent {
  group: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  mixer: THREE.AnimationMixer | null;
  cx: number;
  cz: number;
  baseY: number;
  radius: number;
  speed: number;
  phase: number;
  flapRate: number;
}

interface BoatAgent {
  group: THREE.Group;
  wake: THREE.Mesh;
  x: number;
  zMin: number;
  zMax: number;
  z: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
}

/**
 * Adds autonomous world-life animations across Westgate Bay:
 * - Del Sol Pier Ferris Wheel rotation (with upright gondolas)
 * - Harbor yachts & Bay Patrol boat cruising coastal channels (GLB-upgraded)
 * - Flocks of soaring coastal gulls & park birds with animated wingbeats (Stork.glb)
 * - Circling Sky-Watch helicopter (heli.glb) & South Airport commercial jetliner (airliner_737.glb)
 */
export class LivingWorldController {
  readonly group = new THREE.Group();
  private readonly birds: BirdAgent[] = [];
  private readonly boats: BoatAgent[] = [];
  private readonly worldRoot: THREE.Object3D;
  private heliGroup!: THREE.Group;
  private heliMainRotor!: THREE.Object3D;
  private heliTailRotor!: THREE.Object3D;
  private heliBeacon!: THREE.Mesh;
  private jetGroup!: THREE.Group;
  private jetBeacon!: THREE.Mesh;
  private ferrisRotors: THREE.Object3D[] | null = null;
  private elapsed = 0;

  constructor(worldRoot: THREE.Object3D) {
    this.group.name = "WestgateLivingWorld";
    this.worldRoot = worldRoot;

    this.buildBoats();
    this.buildBirds();
    this.buildAircraft();
  }

  private buildBoats(): void {
    const hullWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.15 });
    const hullNavy = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.2 });
    const hullRed = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.42, metalness: 0.2 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.12, metalness: 0.85 });
    const wakeMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.52 });

    const configs: Array<{ x: number; zMin: number; zMax: number; dir: 1 | -1; speed: number; patrol?: boolean }> = [
      { x: -855, zMin: -540, zMax: 360, dir: 1, speed: 9.5 },
      { x: -915, zMin: -460, zMax: 440, dir: -1, speed: 11.2 },
      { x: -805, zMin: 120, zMax: 520, dir: 1, speed: 7.4 },
      { x: 525, zMin: -280, zMax: 340, dir: -1, speed: 12.0, patrol: true },
    ];

    configs.forEach((cfg, idx) => {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(
        new THREE.BoxGeometry(3.8, 1.35, 13.5),
        cfg.patrol ? hullRed : idx % 2 === 0 ? hullWhite : hullNavy,
      );
      hull.position.y = 0.55;
      hull.castShadow = true;
      g.add(hull);

      const bow = new THREE.Mesh(new THREE.ConeGeometry(1.95, 3.8, 4), hullWhite);
      bow.rotation.x = Math.PI * 0.5;
      bow.rotation.y = Math.PI * 0.25;
      bow.position.set(0, 0.72, 8.2);
      g.add(bow);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 5.4), hullWhite);
      cabin.position.set(0, 1.85, -0.8);
      cabin.castShadow = true;
      g.add(cabin);

      const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.72, 1.4), glassMat);
      windshield.position.set(0, 2.05, 1.65);
      windshield.rotation.x = -0.3;
      g.add(windshield);

      const wake = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 15.0), wakeMat);
      wake.rotation.x = -Math.PI * 0.5;
      wake.position.set(0, 0.18, -13.5);
      g.add(wake);

      const startZ = cfg.zMin + ((cfg.zMax - cfg.zMin) * (idx + 0.5)) / configs.length;
      g.position.set(cfg.x, 0.0, startZ);
      g.rotation.y = cfg.dir === 1 ? 0 : Math.PI;
      this.group.add(g);

      const boat: BoatAgent = {
        group: g,
        wake,
        x: cfg.x,
        zMin: cfg.zMin,
        zMax: cfg.zMax,
        z: startZ,
        dir: cfg.dir,
        speed: cfg.speed,
        phase: idx * 1.7,
      };
      this.boats.push(boat);

      const glbName = cfg.patrol ? "speedboat.glb" : "cruiser_boat.glb";
      const targetLen = cfg.patrol ? 10.0 : 13.5;
      void loadCityGlb(glbName).then((scene) => {
        if (!scene) return;
        const fitted = fitGlbToDimension(scene, "z", targetLen, -0.35);
        fitted.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = false;
        });
        g.clear();
        g.add(fitted, wake);
        wake.position.set(0, 0.16, -targetLen * 0.95);
      });
    });
  }

  private buildBirds(): void {
    const birdWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
    const birdGrey = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.75 });
    const wingGeo = new THREE.BoxGeometry(0.55, 0.04, 0.2);
    const bodyGeo = new THREE.BoxGeometry(0.14, 0.12, 0.42);

    const flockCenters = [
      { cx: -755, cz: 0, y: 26, r: 34, count: 8 }, // Del Sol Pier
      { cx: -670, cz: -280, y: 22, r: 28, count: 6 }, // West Coast beach
      { cx: -115, cz: 395, y: 20, r: 30, count: 7 }, // Mirror Central Park
      { cx: -520, cz: -360, y: 18, r: 24, count: 6 }, // Venice Canals
    ];

    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    for (const flock of flockCenters) {
      for (let i = 0; i < flock.count; i++) {
        const g = new THREE.Group();
        const mat = i % 3 === 0 ? birdGrey : birdWhite;
        const body = new THREE.Mesh(bodyGeo, mat);
        g.add(body);

        const wingL = new THREE.Mesh(wingGeo, mat);
        wingL.position.x = -0.28;
        g.add(wingL);

        const wingR = new THREE.Mesh(wingGeo, mat);
        wingR.position.x = 0.28;
        g.add(wingR);

        this.group.add(g);
        this.birds.push({
          group: g,
          wingL,
          wingR,
          mixer: null,
          cx: flock.cx + (rand() - 0.5) * 14,
          cz: flock.cz + (rand() - 0.5) * 14,
          baseY: flock.y + rand() * 8,
          radius: flock.r * (0.65 + rand() * 0.55),
          speed: 0.24 + rand() * 0.16,
          phase: rand() * Math.PI * 2,
          flapRate: 6.5 + rand() * 3.5,
        });
      }
    }

    void loadCityGltf("bird.glb").then((asset) => {
      if (!asset) return;
      for (let i = 0; i < this.birds.length; i++) {
        const bird = this.birds[i];
        const cloned = asset.scene.clone(true);
        cloned.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
          }
        });
        const fitted = fitGlbToDimension(cloned, "z", 2.1, -0.45);
        bird.group.clear();
        bird.group.add(fitted);
        if (asset.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(cloned);
          const action = mixer.clipAction(asset.animations[0]);
          action.timeScale = bird.flapRate / 6.5;
          action.play();
          mixer.update(bird.phase);
          bird.mixer = mixer;
        }
      }
    });
  }

  private buildAircraft(): void {
    // 1. Sky-Watch Helicopter circling Downtown & Bayshore
    const heli = new THREE.Group();
    const heliBodyMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.5 });
    const heliStripeMat = new THREE.MeshStandardMaterial({ color: 0xe5a93c, roughness: 0.4, metalness: 0.2 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.12, metalness: 0.85 });
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.7 });

    const fuse = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.85, 5.4), heliBodyMat);
    heli.add(fuse);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.32, 4.4), heliStripeMat);
    stripe.position.y = -0.2;
    heli.add(stripe);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.4, 1.6), glassMat);
    nose.position.set(0, -0.05, 3.0);
    heli.add(nose);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 5.2), heliBodyMat);
    boom.position.set(0, 0.25, -4.8);
    heli.add(boom);

    const mainRotor = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.08, 0.35), rotorMat);
    mainRotor.position.set(0, 1.3, 0);
    heli.add(mainRotor);

    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.2), rotorMat);
    tailRotor.position.set(0.32, 0.35, -7.2);
    heli.add(tailRotor);

    const heliBeaconMat = new THREE.MeshStandardMaterial({
      color: 0xff2222,
      emissive: 0xff1111,
      emissiveIntensity: 2.5,
    });
    const heliBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), heliBeaconMat);
    heliBeacon.position.set(0, -1.0, -1.2);
    heli.add(heliBeacon);

    this.group.add(heli);
    this.heliGroup = heli;
    this.heliMainRotor = mainRotor;
    this.heliTailRotor = tailRotor;
    this.heliBeacon = heliBeacon;

    void loadCityGlb("heli.glb").then((scene) => {
      if (!scene) return;
      const fitted = fitGlbToDimension(scene, "z", 8.0, -1.1);
      let glbMain: THREE.Object3D | null = null;
      let glbTail: THREE.Object3D | null = null;
      fitted.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = false;
        const n = o.name.toLowerCase();
        if (n === "empty001" || n === "cube004") glbMain = o;
        else if (n === "empty" || n === "cube002") glbTail = o;
      });
      heli.clear();
      heli.add(fitted, heliBeacon);
      if (glbMain) this.heliMainRotor = glbMain;
      if (glbTail) this.heliTailRotor = glbTail;
    });

    // 2. High-altitude Airport Jetliner
    const jet = new THREE.Group();
    const jetWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.25 });
    const jetBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4, metalness: 0.3 });

    const jetBody = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 22, 10), jetWhite);
    jetBody.rotation.x = Math.PI * 0.5;
    jet.add(jetBody);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(24, 0.32, 4.2), jetWhite);
    wing.position.set(0, -0.35, 1.2);
    jet.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.8, 3.2), jetBlue);
    tail.position.set(0, 2.4, -9.2);
    jet.add(tail);
    const jetBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.38, 6, 6), heliBeaconMat);
    jetBeacon.position.set(0, 1.8, 0);
    jet.add(jetBeacon);

    this.group.add(jet);
    this.jetGroup = jet;
    this.jetBeacon = jetBeacon;

    void loadCityGlb("airliner_737.glb").then((scene) => {
      if (!scene) return;
      const fitted = fitGlbToDimension(scene, "z", 36.0, -4.5, -Math.PI * 0.5);
      fitted.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = false;
      });
      jet.clear();
      jet.add(fitted, jetBeacon);
      jetBeacon.position.set(0, 2.6, 0);
    });
  }

  private collectFerrisRotors(): THREE.Object3D[] {
    const found: THREE.Object3D[] = [];
    this.worldRoot.traverse((o) => {
      if (o.userData?.ferrisRotor) found.push(o);
    });
    return found;
  }

  update(dt: number, focusPos?: THREE.Vector3): void {
    const cdt = Math.min(Math.max(dt, 0), 0.1);
    this.elapsed += cdt;

    // 1. Spin Del Sol Ferris Wheel & keep gondolas upright
    if (!this.ferrisRotors || this.ferrisRotors.length === 0) {
      this.ferrisRotors = this.collectFerrisRotors();
    }
    for (let i = 0; i < this.ferrisRotors.length; i++) {
      const rotor = this.ferrisRotors[i];
      rotor.rotation.z += cdt * 0.15;
      for (let c = 0; c < rotor.children.length; c++) {
        const ch = rotor.children[c];
        if (ch.userData?.ferrisGondola) {
          ch.rotation.z = -rotor.rotation.z;
        }
      }
    }

    // 2. Boats cruising coastal channels
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i];
      b.z += b.dir * b.speed * cdt;
      if (b.z > b.zMax) {
        b.z = b.zMax;
        b.dir = -1;
        b.group.rotation.y = Math.PI;
      } else if (b.z < b.zMin) {
        b.z = b.zMin;
        b.dir = 1;
        b.group.rotation.y = 0;
      }
      const bob = Math.sin(this.elapsed * 1.9 + b.phase);
      b.group.position.set(b.x, 0.12 + bob * 0.14, b.z);
      b.group.rotation.x = bob * 0.025 * b.dir;
      b.group.rotation.z = Math.cos(this.elapsed * 1.4 + b.phase) * 0.03;
      b.wake.scale.x = 0.9 + Math.sin(this.elapsed * 5 + b.phase) * 0.12;
    }

    // 3. Flocking birds (GLB morph-target flapping wings, distance-culled mixer update)
    for (let i = 0; i < this.birds.length; i++) {
      const bird = this.birds[i];
      const ang = this.elapsed * bird.speed + bird.phase;
      const nx = bird.cx + Math.cos(ang) * bird.radius;
      const nz = bird.cz + Math.sin(ang) * bird.radius;
      const tx = -Math.sin(ang);
      const tz = Math.cos(ang);
      bird.group.position.set(nx, bird.baseY + Math.sin(ang * 2 + bird.phase) * 1.6, nz);
      bird.group.rotation.y = Math.atan2(tx, tz);
      if (bird.mixer) {
        if (!focusPos || (nx - focusPos.x) ** 2 + (nz - focusPos.z) ** 2 < 220 * 220) {
          bird.mixer.update(cdt);
        }
      } else {
        const flap = Math.sin(this.elapsed * bird.flapRate + bird.phase) * 0.55;
        bird.wingL.rotation.z = flap;
        bird.wingR.rotation.z = -flap;
      }
    }

    // 4. Helicopter circling Downtown/Coast
    const hAng = this.elapsed * 0.11;
    const hx = -180 + Math.cos(hAng) * 290;
    const hz = -40 + Math.sin(hAng) * 240;
    const htx = -Math.sin(hAng) * 290;
    const htz = Math.cos(hAng) * 240;
    this.heliGroup.position.set(hx, 108 + Math.sin(this.elapsed * 0.7) * 3.5, hz);
    this.heliGroup.rotation.y = Math.atan2(htx, htz);
    this.heliGroup.rotation.x = 0.08;
    this.heliMainRotor.rotation.y += cdt * 28;
    this.heliTailRotor.rotation.x += cdt * 34;
    this.heliBeacon.visible = Math.sin(this.elapsed * 7.5) > 0.25;

    // 5. Airport jetliner cruising south corridor
    const cycleX = ((this.elapsed * 42 + 1200) % 2400) - 1200;
    this.jetGroup.position.set(cycleX, 138 + Math.abs(cycleX) * 0.025, 920);
    this.jetGroup.rotation.y = Math.PI * 0.5;
    this.jetBeacon.visible = Math.sin(this.elapsed * 5.0) > 0.35;
  }
}
