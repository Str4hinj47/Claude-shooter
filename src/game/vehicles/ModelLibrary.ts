import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { type CarId, type TrafficId } from "./catalog";
import {
  addFrontIndicator,
  indicatorMaterial,
  isFrontIndicatorMaterial,
  isIndicatorMaterial,
  type IndicatorUniforms,
} from "./indicators";
import { rigWheels } from "./wheels";

export interface CarModel {
  id: TrafficId;
  scene: THREE.Group;
  length: number;
  width: number;
  height: number;
}

const FERRARI_SKEW = (13.5 * Math.PI) / 180;
const ORIENTATION: Record<TrafficId, number> = {
  golf: 0,
  mercedes: 0,
  audi: Math.PI,
  mustang: 0,
  ferrari: Math.PI + FERRARI_SKEW,
  r8: Math.PI,
  challenger: Math.PI,
  rangerover: Math.PI,
  semi: 0,
  kraz: 0,
};

function separateLampLenses(scene: THREE.Group) {
  scene.updateMatrixWorld(true);
  const lenses = new Map<THREE.Material, THREE.Material>();
  const point = new THREE.Vector3();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !mesh.material.name.startsWith("glass__")) return;
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const index = geometry.index;
    const count = index ? index.count : positions.count;
    const classes: number[] = [];
    for (let i = 0; i + 2 < count; i += 3) {
      let z = 0;
      let y = 0;
      for (let j = 0; j < 3; j++) {
        point.fromBufferAttribute(positions, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld);
        z += point.z / 3;
        y += point.y / 3;
      }
      classes.push(y < 0.96 && (z < -1.5 || z > 2.25) ? 1 : 0);
    }
    if (!classes.includes(1)) return;
    let lens = lenses.get(mesh.material);
    if (!lens) {
      lens = mesh.material.clone();
      const material = lens as THREE.MeshStandardMaterial;
      material.name = mesh.material.name + "__lamp_lens";
      material.color.set(0x999fa6);
      material.transparent = true;
      material.opacity = 0.18;
      material.depthWrite = false;
      material.depthTest = true;
      material.side = THREE.DoubleSide;
      lenses.set(mesh.material, lens);
    }
    const copy = geometry.clone();
    copy.clearGroups();
    let start = 0;
    let previous = classes[0];
    for (let i = 1; i <= classes.length; i++) {
      if (i === classes.length || classes[i] !== previous) {
        copy.addGroup(start * 3, (i - start) * 3, previous);
        start = i;
        previous = classes[i];
      }
    }
    mesh.geometry = copy;
    mesh.material = [mesh.material, lens];
  });
}

function exposeMustangValanceSignals(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const mesh = root.getObjectByName("mustang_mesh_13") as THREE.Mesh | undefined;
  if (!mesh?.isMesh) return;
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position");
  const index = geo.index;
  if (!pos) return;
  const point = new THREE.Vector3();
  const selected: number[] = [];
  const rest: number[] = [];
  const count = index ? index.count : pos.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const tri: number[] = [];
    let lens = true;
    for (let j = 0; j < 3; j++) {
      const n = index ? index.getX(i + j) : i + j;
      tri.push(n);
      point.fromBufferAttribute(pos, n).applyMatrix4(mesh.matrixWorld);
      lens &&=
        Math.abs(point.x) > 0.38 &&
        Math.abs(point.x) < 0.51 &&
        point.y > 0.4 &&
        point.y < 0.46 &&
        point.z < -2.15;
    }
    (lens ? selected : rest).push(...tri);
  }
  if (!selected.length) return;
  const geometryFor = (indices: number[]) => {
    const copy = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) copy.setAttribute(name, geo.getAttribute(name));
    copy.setIndex(indices);
    return copy;
  };
  mesh.geometry = geometryFor(rest);
  const lenses = mesh.clone(false);
  lenses.name = "mustang-front-valance-signals";
  lenses.geometry = geometryFor(selected);
  mesh.parent!.add(lenses);
  lenses.updateWorldMatrix(true, false);
  root.attach(lenses);
  lenses.position.y -= 0.065;
  lenses.position.z -= 0.1;
}

export class ModelLibrary {
  private loader: GLTFLoader;
  private models = new Map<TrafficId, CarModel>();
  private loading = new Map<TrafficId, Promise<CarModel | null>>();
  private paintCache = new Map<string, THREE.MeshStandardMaterial>();

  constructor() {
    const draco = new DRACOLoader();
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
    draco.setDecoderPath(`${base}draco/`);
    draco.setWorkerLimit(1);
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(draco);
  }

  has(id: TrafficId): boolean {
    return this.models.has(id);
  }

  get(id: TrafficId): CarModel | null {
    return this.models.get(id) ?? null;
  }

  async loadModel(id: TrafficId): Promise<CarModel | null> {
    const existing = this.models.get(id);
    if (existing) return existing;
    const inflight = this.loading.get(id);
    if (inflight) return inflight;

    const promise = (async (): Promise<CarModel | null> => {
      try {
        const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
        const gltf: GLTF = await this.loader.loadAsync(`${base}models/${id}.glb`);
        const scene = gltf.scene;
        scene.name = id;
        scene.rotation.y = ORIENTATION[id];
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        scene.position.x -= center.x;
        scene.position.z -= center.z;
        scene.position.y -= box.min.y;

        const tuned = new Set<THREE.Material>();
        scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const mesh = o as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            mesh.frustumCulled = true;
            if (id === "ferrari" && !Array.isArray(mesh.material) && mesh.material.name.startsWith("plate__")) {
              mesh.visible = false;
            }
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) {
              if (tuned.has(m)) continue;
              tuned.add(m);
              const std = m as THREE.MeshStandardMaterial;
              std.envMapIntensity = 0.9;
              if (m.name.startsWith("paint__")) {
                std.metalness = 0.45;
                std.roughness = 0.36;
                const phys = m as THREE.MeshPhysicalMaterial;
                if ("clearcoat" in phys) {
                  phys.clearcoat = 0.4;
                  phys.clearcoatRoughness = 0.22;
                }
              } else if (m.name.startsWith("glass__")) {
                std.color.set(0x0a0f14);
                std.metalness = 0.1;
                std.roughness = 0.06;
                std.transparent = true;
                std.opacity = 0.38;
                std.depthWrite = false;
                std.depthTest = true;
                std.alphaTest = 0;
                std.alphaMap = null;
                if ("transmission" in std) (std as THREE.MeshPhysicalMaterial).transmission = 0;
                std.side = THREE.DoubleSide;
                std.envMapIntensity = 1.4;
              } else if (m.name.startsWith("chrome__")) {
                std.metalness = 1.0;
                std.roughness = 0.12;
                std.envMapIntensity = 1.1;
              } else if (m.name.startsWith("headlight__")) {
                if (id === "golf" && m.name === "headlight__Glass-light-cover") {
                  std.color.set(0xb9cbd2);
                  std.transparent = true;
                  std.opacity = 0.2;
                  std.depthWrite = false;
                  std.depthTest = true;
                  std.side = THREE.DoubleSide;
                  std.emissive.set(0x000000);
                  std.emissiveIntensity = 0;
                } else {
                  std.emissive = new THREE.Color(0xf6f9ff);
                  std.emissiveIntensity = id === "golf" ? 0.28 : 0.85;
                }
              } else if (m.name.startsWith("taillight__")) {
                std.emissive = new THREE.Color(0xff2020);
                std.emissiveIntensity = 0.9;
              } else if (m.name.startsWith("rim__")) {
                std.metalness = 0.75;
                std.roughness = 0.28;
                if (id === "r8") std.side = THREE.DoubleSide;
              } else if (m.name.startsWith("trim__") || m.name.startsWith("carbon__")) {
                std.roughness = 0.55;
                std.metalness = 0.12;
              } else if (m.name.startsWith("tire__")) {
                std.roughness = 0.9;
                std.metalness = 0.0;
                if (id === "r8") std.side = THREE.DoubleSide;
              }
            }
          }
        });

        separateLampLenses(scene);
        const normalized = new THREE.Group();
        normalized.add(scene);
        if (id === "mustang") exposeMustangValanceSignals(normalized);
        rigWheels(normalized, id);

        const model: CarModel = {
          id,
          scene: normalized,
          length: size.z,
          width: size.x,
          height: size.y,
        };
        this.models.set(id, model);
        return model;
      } catch {
        return null;
      } finally {
        this.loading.delete(id);
      }
    })();

    this.loading.set(id, promise);
    return promise;
  }

  create(id: TrafficId, opts: { paint?: number; player?: boolean } = {}): THREE.Group | null {
    const source = this.models.get(id);
    if (!source) return null;
    const paint = opts.paint;
    const inner = source.scene.clone(true);
    const wrapper = new THREE.Group();
    wrapper.name = `${id}_wrapper`;
    wrapper.add(inner);

    const lightCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const headlightCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const headlightIndicators: THREE.MeshStandardMaterial[] = [];
    const indicatorCopies: THREE.MeshStandardMaterial[] = [];
    const brakeIndicatorCopies: THREE.MeshStandardMaterial[] = [];
    const signal: IndicatorUniforms = { left: { value: 0 }, right: { value: 0 }, viewZ: { value: 1 }, brake: { value: 0 } };

    wrapper.updateMatrixWorld(true);
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = !!opts.player;
      mesh.receiveShadow = false;
      const recolor = (mat: THREE.Material) => {
        if ((opts.player || id === "golf") && id !== "semi" && id !== "kraz" && (isIndicatorMaterial(id as CarId, mat) || isFrontIndicatorMaterial(id as CarId, mat))) {
          const meshToCar = new THREE.Matrix4().copy(wrapper.matrixWorld).invert().multiply(mesh.matrixWorld);
          const rear = isIndicatorMaterial(id as CarId, mat);
          let lamp = rear
            ? indicatorMaterial(id as CarId, mat, meshToCar, signal)
            : (mat.clone() as THREE.MeshStandardMaterial);
          if (isFrontIndicatorMaterial(id as CarId, mat)) lamp = addFrontIndicator(id as CarId, lamp, meshToCar, signal);
          if (rear && mat.name.startsWith("taillight__")) {
            lamp.emissiveIntensity = 0.55;
            brakeIndicatorCopies.push(lamp);
          }
          if (mat.name.startsWith("headlight__") && !/cover/i.test(mat.name)) headlightIndicators.push(lamp);
          indicatorCopies.push(lamp);
          return lamp;
        }
        if (mat.name.startsWith("headlight__") && !/cover/i.test(mat.name)) {
          let light = headlightCopies.get(mat);
          if (!light) {
            light = mat.clone() as THREE.MeshStandardMaterial;
            headlightCopies.set(mat, light);
          }
          return light;
        }
        if (mat.name.startsWith("taillight__")) {
          let light = lightCopies.get(mat);
          if (!light) {
            light = mat.clone() as THREE.MeshStandardMaterial;
            light.emissiveIntensity = 0.55;
            lightCopies.set(mat, light);
          }
          return light;
        }
        if (mat.name.startsWith("paint__") && paint !== undefined) {
          const key = `${mat.uuid}:${paint}`;
          let cached = this.paintCache.get(key);
          if (!cached) {
            cached = new THREE.MeshPhysicalMaterial({
              color: paint,
              metalness: 0.45,
              roughness: 0.36,
              clearcoat: 0.4,
              clearcoatRoughness: 0.22,
              envMapIntensity: 0.9,
            });
            this.paintCache.set(key, cached);
          }
          return cached;
        }
        return mat;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolor) : recolor(mesh.material);
    });

    const wheels: THREE.Group[] = [];
    inner.traverse((o) => {
      if (o.name.startsWith("wheel_pivot_")) wheels.push(o as THREE.Group);
    });
    wrapper.userData.wheels = wheels;
    wrapper.userData.brakeMaterials = [...lightCopies.values(), ...brakeIndicatorCopies];
    wrapper.userData.headlightMaterials = [...headlightCopies.values(), ...headlightIndicators];
    wrapper.userData.indicatorMaterials = indicatorCopies;
    wrapper.userData.indicatorState = signal;
    return wrapper;
  }
}

export function setDoorsOpen(carRoot: THREE.Object3D, amount: number): void {
  const clamped = Math.max(0, Math.min(1, amount));
  const maxRad = (62 * Math.PI) / 180;
  carRoot.traverse((obj) => {
    const n = obj.name;
    if (n === "door_fl" || n === "door_rl") {
      obj.rotation.y = -maxRad * clamped;
    } else if (n === "door_fr" || n === "door_rr") {
      obj.rotation.y = maxRad * clamped;
    }
  });
}
