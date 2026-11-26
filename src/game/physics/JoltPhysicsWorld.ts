import * as THREE from "three";
import type initJoltFn from "jolt-physics/wasm-compat";

type JoltModule = Awaited<ReturnType<typeof initJoltFn>>;

let joltPromise: Promise<JoltModule> | null = null;
function ensureJolt(): Promise<JoltModule> {
  if (!joltPromise) {
    joltPromise = import("jolt-physics/wasm-compat")
      .then(({ default: initJolt }) => initJolt())
      .catch((err) => {
        joltPromise = null;
        throw err;
      });
  }
  return joltPromise;
}

const LAYER_NON_MOVING = 0;
const LAYER_MOVING = 1;

interface DynamicDebris {
  bodyId: InstanceType<JoltModule["BodyID"]>;
  mesh: THREE.Mesh;
  age: number;
  maxAge: number;
}

/**
 * JoltPhysics WASM rigid-body simulation for tactile 3D explosion debris,
 * crate/jammer shrapnel, and bullet/blast physics impulses synced to Three.js.
 */
export class JoltPhysicsWorld {
  private jolt: JoltModule | null = null;
  private joltInterface: InstanceType<JoltModule["JoltInterface"]> | null = null;
  private physicsSystem: InstanceType<JoltModule["PhysicsSystem"]> | null = null;
  private bodyInterface: InstanceType<JoltModule["BodyInterface"]> | null = null;
  private root: THREE.Group;
  private staticBodyIds: InstanceType<JoltModule["BodyID"]>[] = [];
  private debris: DynamicDebris[] = [];
  private disposed = false;
  private readyFlag = false;
  private sharedBoxGeo = new THREE.BoxGeometry(1, 1, 1);

  constructor(root: THREE.Group) {
    this.root = root;
  }

  get ready(): boolean {
    return this.readyFlag && !this.disposed;
  }

  async initFromLevel(aabbs: THREE.Box3[], groundY = 0): Promise<boolean> {
    try {
      const Jolt = await ensureJolt();
      if (this.disposed) return false;
      this.jolt = Jolt;

      const settings = new Jolt.JoltSettings();
      settings.mMaxBodies = 1024;
      settings.mMaxBodyPairs = 2048;
      settings.mMaxContactConstraints = 1024;

      const objectFilter = new Jolt.ObjectLayerPairFilterTable(2);
      objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING);
      objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);

      const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
      bpInterface.MapObjectToBroadPhaseLayer(LAYER_NON_MOVING, new Jolt.BroadPhaseLayer(0));
      bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, new Jolt.BroadPhaseLayer(1));

      settings.mObjectLayerPairFilter = objectFilter;
      settings.mBroadPhaseLayerInterface = bpInterface;
      settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
        settings.mBroadPhaseLayerInterface,
        2,
        settings.mObjectLayerPairFilter,
        2,
      );

      this.joltInterface = new Jolt.JoltInterface(settings);
      Jolt.destroy(settings);

      this.physicsSystem = this.joltInterface.GetPhysicsSystem();
      this.physicsSystem.SetGravity(new Jolt.Vec3(0, -18.5, 0));
      this.bodyInterface = this.physicsSystem.GetBodyInterface();

      // Ground plane slab
      const floorShape = new Jolt.BoxShape(new Jolt.Vec3(350, 0.5, 350), 0.05);
      const floorSettings = new Jolt.BodyCreationSettings(
        floorShape,
        new Jolt.RVec3(0, groundY - 0.5, 0),
        Jolt.Quat.prototype.sIdentity(),
        Jolt.EMotionType_Static,
        LAYER_NON_MOVING,
      );
      floorSettings.mFriction = 0.72;
      floorSettings.mRestitution = 0.28;
      const floorBody = this.bodyInterface.CreateBody(floorSettings);
      this.bodyInterface.AddBody(floorBody.GetID(), Jolt.EActivation_DontActivate);
      this.staticBodyIds.push(floorBody.GetID());
      Jolt.destroy(floorSettings);

      // Register compound AABBs (walls, decks, containers) capped reasonably for fast init
      const maxStatic = Math.min(aabbs.length, 320);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      for (let i = 0; i < maxStatic; i++) {
        const b = aabbs[i];
        b.getCenter(center);
        b.getSize(size);
        const hx = Math.max(0.08, size.x * 0.5);
        const hy = Math.max(0.08, size.y * 0.5);
        const hz = Math.max(0.08, size.z * 0.5);
        const shape = new Jolt.BoxShape(new Jolt.Vec3(hx, hy, hz), 0.02);
        const bs = new Jolt.BodyCreationSettings(
          shape,
          new Jolt.RVec3(center.x, center.y, center.z),
          Jolt.Quat.prototype.sIdentity(),
          Jolt.EMotionType_Static,
          LAYER_NON_MOVING,
        );
        bs.mFriction = 0.65;
        bs.mRestitution = 0.3;
        const body = this.bodyInterface.CreateBody(bs);
        this.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);
        this.staticBodyIds.push(body.GetID());
        Jolt.destroy(bs);
      }

      this.readyFlag = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Spawn physical tumbling 3D debris chunks that bounce off terrain & walls.
   */
  spawnDebrisBurst(
    origin: THREE.Vector3,
    count = 10,
    colorHex = 0x555d66,
    scale = 1.0,
    impulseScale = 1.0,
  ) {
    if (!this.ready || !this.jolt || !this.bodyInterface) return;
    const Jolt = this.jolt;

    // Evict oldest debris if over cap (keeps frame budget flat)
    while (this.debris.length + count > 48 && this.debris.length > 0) {
      this.removeDebrisAt(0);
    }

    for (let i = 0; i < count; i++) {
      const sx = (0.12 + Math.random() * 0.24) * scale;
      const sy = (0.06 + Math.random() * 0.14) * scale;
      const sz = (0.14 + Math.random() * 0.28) * scale;
      const ang = Math.random() * Math.PI * 2;
      const rad = 0.15 + Math.random() * 0.45;
      const px = origin.x + Math.cos(ang) * rad;
      const py = origin.y + 0.35 + Math.random() * 0.5;
      const pz = origin.z + Math.sin(ang) * rad;

      const shape = new Jolt.BoxShape(new Jolt.Vec3(sx * 0.5, sy * 0.5, sz * 0.5), 0.015);
      const bs = new Jolt.BodyCreationSettings(
        shape,
        new Jolt.RVec3(px, py, pz),
        Jolt.Quat.prototype.sIdentity(),
        Jolt.EMotionType_Dynamic,
        LAYER_MOVING,
      );
      bs.mRestitution = 0.38;
      bs.mFriction = 0.62;
      bs.mLinearDamping = 0.08;
      bs.mAngularDamping = 0.08;

      const body = this.bodyInterface.CreateBody(bs);
      Jolt.destroy(bs);
      const bodyId = body.GetID();
      this.bodyInterface.AddBody(bodyId, Jolt.EActivation_Activate);

      const spd = (3.5 + Math.random() * 7.5) * impulseScale;
      const up = (4.2 + Math.random() * 6.5) * impulseScale;
      this.bodyInterface.SetLinearVelocity(
        bodyId,
        new Jolt.Vec3(Math.cos(ang) * spd, up, Math.sin(ang) * spd),
      );
      this.bodyInterface.SetAngularVelocity(
        bodyId,
        new Jolt.Vec3(
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 18,
        ),
      );

      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.65,
        metalness: 0.35,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(this.sharedBoxGeo, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.noNav = true;
      this.root.add(mesh);

      this.debris.push({
        bodyId,
        mesh,
        age: 0,
        maxAge: 4.5 + Math.random() * 2.5,
      });
    }
  }

  /** Apply an outward radial blast impulse to nearby dynamic debris */
  applyExplosionBlast(origin: THREE.Vector3, radius = 8, force = 12) {
    if (!this.ready || !this.jolt || !this.bodyInterface) return;
    const Jolt = this.jolt;
    const r2 = radius * radius;
    for (const d of this.debris) {
      const dx = d.mesh.position.x - origin.x;
      const dy = d.mesh.position.y - origin.y + 0.5;
      const dz = d.mesh.position.z - origin.z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > r2 || dist2 < 1e-4) continue;
      const dist = Math.sqrt(dist2);
      const falloff = 1 - dist / radius;
      const imp = force * falloff;
      this.bodyInterface.ActivateBody(d.bodyId);
      this.bodyInterface.AddImpulse(
        d.bodyId,
        new Jolt.Vec3((dx / dist) * imp, (0.4 + dy / dist) * imp, (dz / dist) * imp),
      );
    }
  }

  step(dt: number) {
    if (!this.ready || !this.joltInterface || !this.bodyInterface) return;
    const clampedDt = Math.min(0.033, Math.max(0.001, dt));
    const subSteps = clampedDt > 1 / 55 ? 2 : 1;
    this.joltInterface.Step(clampedDt, subSteps);

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      if (d.age >= d.maxAge) {
        this.removeDebrisAt(i);
        continue;
      }
      const p = this.bodyInterface.GetPosition(d.bodyId);
      const q = this.bodyInterface.GetRotation(d.bodyId);
      d.mesh.position.set(p.GetX(), p.GetY(), p.GetZ());
      d.mesh.quaternion.set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
      if (d.age > d.maxAge - 1.0) {
        (d.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, d.maxAge - d.age);
      }
    }
  }

  private removeDebrisAt(index: number) {
    const d = this.debris[index];
    if (!d) return;
    if (this.bodyInterface) {
      try {
        this.bodyInterface.RemoveBody(d.bodyId);
        this.bodyInterface.DestroyBody(d.bodyId);
      } catch {}
    }
    this.root.remove(d.mesh);
    (d.mesh.material as THREE.Material).dispose();
    this.debris.splice(index, 1);
  }

  dispose() {
    this.disposed = true;
    this.readyFlag = false;
    while (this.debris.length > 0) {
      this.removeDebrisAt(this.debris.length - 1);
    }
    if (this.bodyInterface) {
      for (const id of this.staticBodyIds) {
        try {
          this.bodyInterface.RemoveBody(id);
          this.bodyInterface.DestroyBody(id);
        } catch {}
      }
    }
    this.staticBodyIds = [];
    this.sharedBoxGeo.dispose();
    if (this.joltInterface && this.jolt) {
      try {
        this.jolt.destroy(this.joltInterface);
      } catch {}
    }
    this.joltInterface = null;
    this.physicsSystem = null;
    this.bodyInterface = null;
    this.jolt = null;
  }
}
