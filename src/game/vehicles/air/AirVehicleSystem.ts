import * as THREE from "three";
import { clamp, damp, wrapAngle } from "../../../character/math";
import { fitGlbToDimension, loadCityGlb } from "../../city/PropModels";

export type AirKind = "helicopter" | "airplane";

export interface AirInput {
  throttle: number; // W/S (+1/-1)
  roll: number;     // A/D (+1/-1)
  yaw: number;      // Q/E (+1/-1)
  climb: number;    // Space (+1) / Shift (-1)
}

export interface FlyableAircraft {
  id: string;
  name: string;
  kind: AirKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
  rotorPower: number;
  group: THREE.Group;
  rotors: THREE.Object3D[];
  beacon: THREE.Mesh;
  hp: number;
  maxHp: number;
  homePos: THREE.Vector3;
  homeYaw: number;
}

/**
 * MIT-inspired Helicopter (Sketchbook collective/cyclic + gyro stabilization)
 * and Fixed-Wing Aircraft (open-road wing lift & aerodynamic drag) system.
 */
export class AirVehicleSystem {
  readonly group = new THREE.Group();
  readonly aircraft: FlyableAircraft[] = [];
  activeAircraft: FlyableAircraft | null = null;
  onRotorDownwash?: (pos: THREE.Vector3, overWater: boolean, power: number) => void;

  private animT = 0;
  private downwashAcc = 0;
  private readonly groundAt: (x: number, z: number, maxY: number) => number;
  private readonly terrainAt: (x: number, z: number) => number;

  constructor(
    terrainAt: (x: number, z: number) => number,
    groundAt: (x: number, z: number, maxY: number) => number,
  ) {
    this.group.name = "westgate-air-vehicles";
    this.terrainAt = terrainAt;
    this.groundAt = groundAt;
    this.spawnFleet();
  }

  private buildHelicopterMesh(accentHex: number): { group: THREE.Group; rotors: THREE.Object3D[] } {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.3, metalness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.65, metalness: 0.45 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.08,
      metalness: 0.88,
      transparent: true,
      opacity: 0.72,
    });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.4, metalness: 0.5 });

    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.45, 4.2), hullMat);
    fuselage.position.set(0, 1.35, 0.2);
    fuselage.castShadow = true;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.58, 1.15, 1.35), glassMat);
    nose.position.set(0, 1.45, 2.35);
    const tailBoom = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 4.4), hullMat);
    tailBoom.position.set(0, 1.55, -3.5);
    tailBoom.castShadow = true;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.15, 0.72), hullMat);
    fin.position.set(0, 2.0, -5.45);

    // Landing skids
    for (const sx of [-0.92, 0.92]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 3.8), darkMat);
      skid.position.set(sx, 0.08, 0.25);
      const strutF = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), darkMat);
      strutF.position.set(sx, 0.38, 1.1);
      const strutR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), darkMat);
      strutR.position.set(sx, 0.38, -0.75);
      g.add(skid, strutF, strutR);
    }

    // Main rotor mast + 4 blades
    const mainRotor = new THREE.Group();
    mainRotor.position.set(0, 2.35, 0.1);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.45, 10), darkMat);
    mast.position.y = -0.15;
    mainRotor.add(mast);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 4.6), bladeMat);
      blade.rotation.y = (i * Math.PI) / 2;
      blade.position.set(Math.sin(blade.rotation.y) * 2.3, 0.05, Math.cos(blade.rotation.y) * 2.3);
      mainRotor.add(blade);
    }

    // Tail rotor
    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.2, 2.05, -5.45);
    const tb1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.25, 0.14), bladeMat);
    const tb2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 1.25), bladeMat);
    tailRotor.add(tb1, tb2);
    tailRotor.userData.isTailRotor = true;

    g.add(fuselage, nose, tailBoom, fin, mainRotor, tailRotor);
    return { group: g, rotors: [mainRotor, tailRotor] };
  }

  private buildAirplaneMesh(accentHex: number): { group: THREE.Group; rotors: THREE.Object3D[] } {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.28, metalness: 0.35 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.32, metalness: 0.45 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.08, metalness: 0.85 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.7, metalness: 0.4 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.15, 5.6), hullMat);
    body.position.set(0, 1.15, 0);
    body.castShadow = true;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.65, 1.85), glassMat);
    canopy.position.set(0, 1.72, 0.35);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.14, 1.65), stripeMat);
    wing.position.set(0, 1.05, 0.45);
    wing.castShadow = true;
    const tailH = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.95), stripeMat);
    tailH.position.set(0, 1.25, -2.45);
    const tailV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 1.05), stripeMat);
    tailV.position.set(0, 1.85, -2.4);

    // Tricycle landing gear
    for (const [gx, gz] of [[0, 2.05], [-1.35, 0.2], [1.35, 0.2]] as const) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.65, 6), darkMat);
      strut.position.set(gx, 0.55, gz);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 10), darkMat);
      wheel.rotation.z = Math.PI * 0.5;
      wheel.position.set(gx, 0.24, gz);
      g.add(strut, wheel);
    }

    const prop = new THREE.Group();
    prop.position.set(0, 1.18, 2.9);
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 0.05), darkMat);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.05), darkMat);
    prop.add(p1, p2);
    prop.userData.isProp = true;

    g.add(body, canopy, wing, tailH, tailV, prop);
    return { group: g, rotors: [prop] };
  }

  private spawnFleet(): void {
    const spawns: Array<{
      id: string;
      name: string;
      kind: AirKind;
      glb: string;
      targetLen: number;
      x: number;
      z: number;
      yawDeg: number;
      hex: number;
    }> = [
      { id: "heli_medical", name: "Westgate Maverick Heli", kind: "helicopter", glb: "heli.glb", targetLen: 6.0, x: -146, z: -206, yawDeg: 180, hex: 0x0ea5e9 },
      { id: "heli_observatory", name: "Summit Tour Chopper", kind: "helicopter", glb: "heli.glb", targetLen: 6.0, x: -112, z: -956, yawDeg: 160, hex: 0xf59e0b },
      { id: "plane_airport", name: "Westgate F-16 Jet", kind: "airplane", glb: "jet.glb", targetLen: 12.5, x: -120, z: 960, yawDeg: 90, hex: 0xef4444 },
      { id: "plane_seaport", name: "Cirrus SR-22 Plane", kind: "airplane", glb: "plane.glb", targetLen: 8.2, x: 595, z: 360, yawDeg: 180, hex: 0x10b981 },
    ];

    const beaconGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2b2b });

    for (const sp of spawns) {
      const ty = this.terrainAt(sp.x, sp.z);
      const gy = this.groundAt(sp.x, sp.z, ty + 25);
      const yaw = THREE.MathUtils.degToRad(sp.yawDeg);
      const mesh = sp.kind === "helicopter" ? this.buildHelicopterMesh(sp.hex) : this.buildAirplaneMesh(sp.hex);
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(0, sp.kind === "helicopter" ? 2.15 : 1.75, sp.kind === "helicopter" ? -1.1 : -2.4);
      beacon.visible = false;
      mesh.group.add(beacon);
      mesh.group.position.set(sp.x, gy, sp.z);
      mesh.group.rotation.y = yaw;
      this.group.add(mesh.group);

      const ac: FlyableAircraft = {
        id: sp.id,
        name: sp.name,
        kind: sp.kind,
        pos: new THREE.Vector3(sp.x, gy, sp.z),
        vel: new THREE.Vector3(),
        yaw,
        pitch: 0,
        roll: 0,
        speed: 0,
        throttle: 0,
        rotorPower: 0,
        group: mesh.group,
        rotors: mesh.rotors,
        beacon,
        hp: 160,
        maxHp: 160,
        homePos: new THREE.Vector3(sp.x, gy, sp.z),
        homeYaw: yaw,
      };
      this.aircraft.push(ac);

      void loadCityGlb(sp.glb).then((scene) => {
        if (!scene) return;
        const fitted = fitGlbToDimension(scene, "z", sp.targetLen, 0);
        const glbRotors: THREE.Object3D[] = [];
        fitted.traverse((o) => {
          const n = o.name.toLowerCase();
          if (sp.kind === "helicopter") {
            if (n === "empty001" || n === "cube004") glbRotors.push(o);
            else if (n === "empty" || n === "cube002") {
              o.userData.isTailRotor = true;
              glbRotors.push(o);
            }
          } else if (n === "prop") {
            o.userData.isProp = true;
            glbRotors.push(o);
          }
        });
        ac.group.clear();
        ac.group.add(fitted, beacon);
        ac.rotors = glbRotors;
      });
    }
  }

  findNearestEnterable(pos: THREE.Vector3, maxDist = 6.5): FlyableAircraft | null {
    if (this.activeAircraft) return null;
    let best: FlyableAircraft | null = null;
    let bestD2 = maxDist * maxDist;
    for (const a of this.aircraft) {
      if (Math.abs(a.pos.y - pos.y) > 4.5) continue;
      const d2 = (a.pos.x - pos.x) ** 2 + (a.pos.z - pos.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = a;
      }
    }
    return best;
  }

  enterAircraft(a: FlyableAircraft): void {
    this.activeAircraft = a;
  }

  exitAircraft(): { pos: THREE.Vector3; altitudeAboveGround: number } | null {
    const a = this.activeAircraft;
    if (!a) return null;
    this.activeAircraft = null;
    const lx = Math.cos(a.yaw);
    const lz = -Math.sin(a.yaw);
    const ex = new THREE.Vector3(a.pos.x + lx * 2.8, a.pos.y, a.pos.z + lz * 2.8);
    const gy = this.groundAt(ex.x, ex.z, ex.y + 2);
    const alt = Math.max(0, ex.y - gy);
    if (alt < 2.2) ex.y = gy;
    return { pos: ex, altitudeAboveGround: alt };
  }

  update(dt: number, input: AirInput): void {
    const cdt = Math.min(Math.max(dt, 0), 0.05);
    this.animT += cdt;
    this.downwashAcc += cdt;
    const emitDownwash = this.downwashAcc >= 0.09;
    if (emitDownwash) this.downwashAcc = 0;

    const strobeOn = Math.sin(this.animT * 7.5) > 0.35;
    for (const a of this.aircraft) {
      const isActive = a === this.activeAircraft;
      const effIn = isActive ? input : { throttle: 0, roll: 0, yaw: 0, climb: 0 };

      if (a.kind === "helicopter") {
        this.stepHelicopter(a, cdt, effIn, isActive);
      } else {
        this.stepAirplane(a, cdt, effIn, isActive);
      }

      a.beacon.visible = a.rotorPower > 0.18 && strobeOn;

      // Rotor downwash spray/dust when hovering low over water or terrain
      if (emitDownwash && a.kind === "helicopter" && a.rotorPower > 0.45 && this.onRotorDownwash) {
        const ty = this.terrainAt(a.pos.x, a.pos.z);
        const gy = this.groundAt(a.pos.x, a.pos.z, a.pos.y + 1.5);
        const surfY = Math.max(0, gy);
        const alt = a.pos.y - surfY;
        if (alt >= -0.2 && alt < 13.5) {
          const power = (1 - alt / 13.5) * a.rotorPower;
          const overWater = ty < -0.15 && gy < 0.25;
          this.onRotorDownwash(new THREE.Vector3(a.pos.x, surfY + 0.08, a.pos.z), overWater, power);
        }
      }

      // Spin main rotor / tail rotor / propeller
      for (const r of a.rotors) {
        if (r.userData.isTailRotor) r.rotation.x += a.rotorPower * cdt * 34;
        else if (r.userData.isProp) r.rotation.z += a.rotorPower * cdt * 38;
        else r.rotation.y += a.rotorPower * cdt * 26;
      }

      a.group.position.copy(a.pos);
      a.group.rotation.order = "YXZ";
      a.group.rotation.set(a.pitch, a.yaw, a.roll);
    }
  }

  private stepHelicopter(a: FlyableAircraft, dt: number, input: AirInput, active: boolean): void {
    a.rotorPower = damp(a.rotorPower, active ? 1 : 0, active ? 2.2 : 0.85, dt);
    const gy = Math.max(2.0, this.groundAt(a.pos.x, a.pos.z, a.pos.y + 2.5));
    const grounded = a.pos.y <= gy + 0.08;

    // Cyclic pitch/roll + tail rotor yaw
    const targetPitch = active ? input.throttle * 0.34 : 0;
    const targetRoll = active ? -input.roll * 0.42 : 0;
    a.pitch = damp(a.pitch, grounded && input.climb <= 0 ? 0 : targetPitch, 4.5, dt);
    a.roll = damp(a.roll, grounded && input.climb <= 0 ? 0 : targetRoll, 4.5, dt);
    if (active) {
      a.yaw = wrapAngle(a.yaw + (input.yaw * 1.45 + input.roll * 0.65) * dt);
    }

    // Collective vertical acceleration + hover stabilization
    const hoverLift = active ? 9.81 * a.rotorPower : 0;
    const climbAccel = active ? input.climb * 15.5 * a.rotorPower : -9.81;
    a.vel.y += (hoverLift + climbAccel - 9.81) * dt;
    if (active && Math.abs(input.climb) < 0.05 && a.rotorPower > 0.75) {
      a.vel.y = damp(a.vel.y, 0, 3.6, dt);
    }

    // Cyclic horizontal thrust from tilt
    const fx = Math.sin(a.yaw);
    const fz = Math.cos(a.yaw);
    const rx = Math.cos(a.yaw);
    const rz = -Math.sin(a.yaw);
    if (!grounded || input.climb > 0) {
      const fwdThrust = Math.sin(a.pitch) * 34 * a.rotorPower;
      const sideThrust = -Math.sin(a.roll) * 28 * a.rotorPower;
      a.vel.x += (fx * fwdThrust - rx * sideThrust) * dt;
      a.vel.z += (fz * fwdThrust - rz * sideThrust) * dt;
    }
    a.vel.x *= Math.exp(-0.85 * dt);
    a.vel.z *= Math.exp(-0.85 * dt);

    a.pos.x = clamp(a.pos.x + a.vel.x * dt, -1180, 1180);
    a.pos.z = clamp(a.pos.z + a.vel.z * dt, -1180, 1180);
    a.pos.y = clamp(a.pos.y + a.vel.y * dt, gy, 420);
    if (a.pos.y <= gy + 0.01) {
      a.pos.y = gy;
      a.vel.y = Math.max(0, a.vel.y);
      a.vel.x *= Math.exp(-5 * dt);
      a.vel.z *= Math.exp(-5 * dt);
    }
    a.speed = a.vel.length();
  }

  private stepAirplane(a: FlyableAircraft, dt: number, input: AirInput, active: boolean): void {
    if (active) {
      if (input.throttle > 0.1) a.throttle = clamp(a.throttle + 0.55 * dt, 0, 1);
      else if (input.throttle < -0.1) a.throttle = clamp(a.throttle - 0.7 * dt, 0, 1);
    } else {
      a.throttle = clamp(a.throttle - 0.4 * dt, 0, 1);
    }
    a.rotorPower = damp(a.rotorPower, active ? Math.max(0.35, a.throttle) : 0, 3.0, dt);

    const gy = Math.max(2.0, this.groundAt(a.pos.x, a.pos.z, a.pos.y + 2.5));
    const grounded = a.pos.y <= gy + 0.15;

    // Aerodynamic forward thrust & wing drag
    const thrust = a.throttle * 34;
    const drag = 0.009 * a.speed * a.speed + (grounded ? 0.35 : 0.08) * a.speed;
    a.speed = clamp(a.speed + (thrust - drag) * dt, 0, 68);

    // Control surfaces scale with airspeed
    const ctrlAuth = clamp(a.speed / 18, 0.1, 1);
    if (active) {
      const targetRoll = -input.roll * 0.72 * ctrlAuth;
      a.roll = grounded ? damp(a.roll, 0, 8, dt) : damp(a.roll, targetRoll, 4.0, dt);
      const targetPitch = input.climb * 0.48 * ctrlAuth;
      a.pitch = damp(a.pitch, grounded && input.climb <= 0 ? 0 : targetPitch, 3.8, dt);
      const bankTurn = -Math.sin(a.roll) * 0.95;
      a.yaw = wrapAngle(a.yaw + (input.yaw * 0.9 + bankTurn) * ctrlAuth * dt);
    } else {
      a.roll = damp(a.roll, 0, 3, dt);
      a.pitch = damp(a.pitch, 0, 3, dt);
    }

    // Wing lift counteracts gravity once airspeed > ~18 m/s
    const liftRatio = clamp((a.speed - 12) / 14, 0, 1.15);
    const fx = Math.sin(a.yaw) * Math.cos(a.pitch);
    const fy = Math.sin(a.pitch);
    const fz = Math.cos(a.yaw) * Math.cos(a.pitch);

    a.vel.x = fx * a.speed;
    a.vel.z = fz * a.speed;
    const gravityPull = (1 - liftRatio) * 9.81;
    a.vel.y = fy * a.speed - gravityPull;

    a.pos.x = clamp(a.pos.x + a.vel.x * dt, -1180, 1180);
    a.pos.z = clamp(a.pos.z + a.vel.z * dt, -1180, 1180);
    a.pos.y = clamp(a.pos.y + a.vel.y * dt, gy, 460);
    if (a.pos.y <= gy + 0.01) {
      a.pos.y = gy;
      a.vel.y = Math.max(0, a.vel.y);
    }
  }

  getBlips(): Array<{ id: string; name: string; kind: AirKind; x: number; z: number }> {
    return this.aircraft.map((a) => ({ id: a.id, name: a.name, kind: a.kind, x: a.pos.x, z: a.pos.z }));
  }
}
