import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { isCarId, type CarId, type TrafficId } from "./catalog";
import { type CarCustomConfig, DEFAULT_CAR_CUSTOM } from "../progression";
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
  sedan: Math.PI,
  offroad: Math.PI,
  compact: Math.PI,
  hatch: Math.PI,
  crossover: Math.PI,
  taxi: Math.PI,
  police_cruiser: Math.PI,
  van: Math.PI,
  delivery: Math.PI,
  garbage_truck: Math.PI,
  ambulance: Math.PI,
  firetruck: Math.PI,
  semi: 0,
  kraz: 0,
};

function prepareNpcModel(scene: THREE.Group, id: TrafficId): void {
  if (id === "sedan" || id === "offroad") {
    const wheels: Record<string, [number, number, number]> =
      id === "sedan"
        ? {
            FL: [0.74, -0.22, 1.354],
            FR: [-0.739, -0.22, 1.354],
            RL: [0.74, -0.22, -1.236],
            RR: [-0.739, -0.22, -1.236],
          }
        : {
            FL: [0.784, -0.24, 1.429],
            FR: [-0.784, -0.24, 1.429],
            RL: [0.784, -0.24, -1.191],
            RR: [-0.784, -0.24, -1.191],
          };
    for (const [corner, pos] of Object.entries(wheels)) {
      const tire = scene.getObjectByName(`tire_${corner}`);
      if (tire) tire.position.set(pos[0], pos[1], pos[2]);
      const cal = scene.getObjectByName(`caliper_${corner}`);
      if (cal) cal.position.set(pos[0], pos[1], pos[2]);
    }
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const matName = Array.isArray(mesh.material) ? "" : mesh.material.name || "";
      const objName = `${mesh.parent?.name ?? ""}/${mesh.name}`;
      if (matName === "paint") {
        const cloned = (mesh.material as THREE.Material).clone();
        cloned.name = `paint__${id}`;
        mesh.material = cloned;
      } else if (matName === "glass") {
        const cloned = (mesh.material as THREE.Material).clone();
        cloned.name = `glass__${id}`;
        mesh.material = cloned;
      } else if (matName === "lights") {
        const cloned = (mesh.material as THREE.Material).clone();
        cloned.name = /light_R[LR]/i.test(objName) ? `taillight__${id}` : `headlight__${id}`;
        mesh.material = cloned;
      } else if (matName === "tire") {
        const cloned = (mesh.material as THREE.Material).clone();
        cloned.name = `tire__${id}`;
        mesh.material = cloned;
      } else if (matName === "underbody" || matName.startsWith("trim_matte")) {
        const cloned = (mesh.material as THREE.Material).clone();
        cloned.name = `trim__${id}`;
        mesh.material = cloned;
      }
    });
    return;
  }

  if (id === "compact") scene.scale.set(1, 1.18, 1);
  else if (id === "hatch") scene.scale.setScalar(1.1);
  else if (id === "taxi") scene.scale.set(1, 1.12, 1);
  else if (id === "police_cruiser") scene.scale.setScalar(1.14);

  if (id === "compact" || id === "hatch" || id === "crossover" || id === "taxi" || id === "police_cruiser") {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const cloned = mesh.material.clone();
      const n = mesh.name;
      if (n === "Windows") cloned.name = `glass__${id}`;
      else if (n === "Headlights" || n === "BlueLights" || n === "WhiteLights") cloned.name = `headlight__${id}`;
      else if (n === "TailLights") cloned.name = `taillight__${id}`;
      else if (n === "Black") cloned.name = `tire__${id}`;
      else if (n === "Grey" || n === "Material007") cloned.name = `trim__${id}`;
      else if ((n === "Blue" || n === "LightBlue" || n === "White") && id !== "police_cruiser") {
        cloned.name = `paint__${id}`;
      } else {
        cloned.name = `trim__${id}_livery`;
      }
      mesh.material = cloned;
    });
    return;
  }

  const kenneyScale: Partial<Record<TrafficId, number>> = {
    van: 1.55,
    delivery: 1.65,
    ambulance: 1.68,
    firetruck: 1.85,
    garbage_truck: 1.85,
  };
  const ks = kenneyScale[id];
  if (ks) {
    scene.scale.setScalar(ks);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const cloned = mesh.material.clone();
      cloned.name = /^wheel-/.test(mesh.name) ? `tire__${id}` : `trim__${id}_livery`;
      mesh.material = cloned;
    });
  }
}

interface AutoDetailMaps {
  flakeRoughness: THREE.DataTexture;
  treadRoughness: THREE.DataTexture;
  carbonRoughness: THREE.DataTexture;
  contactShadowTex: THREE.DataTexture;
}

let cachedAutoMaps: AutoDetailMaps | null = null;
function getAutoDetailMaps(): AutoDetailMaps {
  if (cachedAutoMaps) return cachedAutoMaps;

  const makeNoise = (size: number, repeat: number, fn: (x: number, y: number) => number) => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = Math.max(0, Math.min(255, Math.round(fn(x, y) * 255)));
        const i = (y * size + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  };

  // Subtle automotive metallic micro-flake variation
  const flakeRoughness = makeNoise(128, 18, (x, y) => {
    const h = Math.sin(x * 37.13 + y * 91.71) * 43758.5453;
    const n = h - Math.floor(h);
    return 0.19 + (n - 0.5) * 0.06;
  });

  // Vulcanized tire tread & sidewall grain
  const treadRoughness = makeNoise(128, 14, (x, y) => {
    const rib = (x & 7) < 2 ? 0.12 : 0;
    const diag = ((x + y) & 15) < 3 ? 0.08 : 0;
    const h = Math.sin(x * 19.7 + y * 53.1) * 19283.1;
    return 0.8 + rib - diag + (h - Math.floor(h) - 0.5) * 0.08;
  });

  // Fine 2x2 carbon / satin polymer trim weave
  const carbonRoughness = makeNoise(128, 22, (x, y) => {
    const twill = (((x >> 1) + (y >> 1)) & 1) === 0 ? 0.09 : -0.07;
    return 0.42 + twill;
  });

  // Soft under-chassis ambient contact shadow texture
  const sz = 128;
  const shadowData = new Uint8Array(sz * sz * 4);
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const nx = (x / (sz - 1)) * 2 - 1;
      const ny = (y / (sz - 1)) * 2 - 1;
      const d = Math.sqrt(nx * nx * 1.15 + ny * ny * 0.92);
      const a = Math.max(0, 1 - Math.min(1, d));
      const smooth = a * a * (3 - 2 * a);
      const i = (y * sz + x) * 4;
      shadowData[i] = 6;
      shadowData[i + 1] = 8;
      shadowData[i + 2] = 12;
      shadowData[i + 3] = Math.round(smooth * 175);
    }
  }
  const contactShadowTex = new THREE.DataTexture(shadowData, sz, sz, THREE.RGBAFormat);
  contactShadowTex.needsUpdate = true;

  cachedAutoMaps = { flakeRoughness, treadRoughness, carbonRoughness, contactShadowTex };
  return cachedAutoMaps;
}

function tuneAutomotiveMaterial(orig: THREE.Material, id: TrafficId): THREE.Material {
  const std = orig as THREE.MeshStandardMaterial;
  const maps = getAutoDetailMaps();
  const name = orig.name || "";

  for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap]) {
    if (tex) tex.anisotropy = 4;
  }
  if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;

  if (name.startsWith("paint__")) {
    const phys = new THREE.MeshPhysicalMaterial({
      name,
      color: std.color ? std.color.clone() : new THREE.Color(0x94a3b8),
      map: std.map ?? null,
      normalMap: std.normalMap ?? null,
      aoMap: std.aoMap ?? null,
      roughnessMap: std.roughnessMap ?? maps.flakeRoughness,
      metalness: 0.44,
      roughness: 0.21,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      ior: 1.5,
      specularIntensity: 1.0,
      envMapIntensity: 1.45,
      side: std.side,
    });
    if (phys.normalMap) phys.normalScale.set(1.15, 1.15);
    return phys;
  }

  if (name.startsWith("glass__")) {
    const phys = new THREE.MeshPhysicalMaterial({
      name,
      color: new THREE.Color(0x060b12),
      metalness: 0.16,
      roughness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      ior: 1.52,
      reflectivity: 1.0,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      envMapIntensity: 1.9,
    });
    return phys;
  }

  std.envMapIntensity = 1.15;
  if (name.startsWith("chrome__")) {
    std.metalness = 1.0;
    std.roughness = 0.08;
    std.envMapIntensity = 1.65;
  } else if (name.startsWith("headlight__")) {
    if (id === "golf" && name === "headlight__Glass-light-cover") {
      std.color.set(0xb9cbd2);
      std.transparent = true;
      std.opacity = 0.22;
      std.depthWrite = false;
      std.depthTest = true;
      std.side = THREE.DoubleSide;
      std.emissive.set(0x000000);
      std.emissiveIntensity = 0;
    } else {
      std.emissive = new THREE.Color(0xf6f9ff);
      std.emissiveIntensity = id === "golf" ? 0.35 : 0.85;
    }
  } else if (name.startsWith("taillight__")) {
    std.emissive = new THREE.Color(0xff2020);
    std.emissiveIntensity = 0.85;
  } else if (name.startsWith("rim__")) {
    std.metalness = 0.88;
    std.roughness = 0.18;
    std.envMapIntensity = 1.45;
    if (id === "r8") std.side = THREE.DoubleSide;
  } else if (name.startsWith("brake__")) {
    std.metalness = 0.82;
    std.roughness = 0.28;
    std.envMapIntensity = 1.25;
  } else if (name.startsWith("trim__") || name.startsWith("carbon__")) {
    std.roughness = 0.42;
    std.metalness = 0.16;
    if (!std.roughnessMap) std.roughnessMap = maps.carbonRoughness;
    if (!std.normalMap && !std.bumpMap) {
      std.bumpMap = maps.carbonRoughness;
      std.bumpScale = 0.005;
    }
    std.envMapIntensity = 0.95;
  } else if (name.startsWith("tire__")) {
    std.roughness = 0.86;
    std.metalness = 0.02;
    if (std.color && std.color.getHex() > 0x383838 && !std.map) {
      std.color.setHex(0x16181c);
    }
    if (!std.roughnessMap) std.roughnessMap = maps.treadRoughness;
    if (!std.normalMap && !std.bumpMap) {
      std.bumpMap = maps.treadRoughness;
      std.bumpScale = 0.012;
    }
    std.envMapIntensity = 0.55;
    if (id === "r8") std.side = THREE.DoubleSide;
  }
  return std;
}

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
    this.loader.setMeshoptDecoder(MeshoptDecoder);
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
        await MeshoptDecoder.ready;
        const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
        const gltf: GLTF = await this.loader.loadAsync(`${base}models/${id}.glb`);
        const scene = gltf.scene;
        scene.name = id;
        prepareNpcModel(scene, id);
        scene.rotation.y = ORIENTATION[id];
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        scene.position.x -= center.x;
        scene.position.z -= center.z;
        scene.position.y -= box.min.y;

        const tuned = new Map<THREE.Material, THREE.Material>();
        scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const mesh = o as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = true;
            if (id === "ferrari" && !Array.isArray(mesh.material) && mesh.material.name.startsWith("plate__")) {
              mesh.visible = false;
            }
            const tuneOne = (m: THREE.Material) => {
              let out = tuned.get(m);
              if (!out) {
                out = tuneAutomotiveMaterial(m, id);
                tuned.set(m, out);
              }
              return out;
            };
            mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tuneOne) : tuneOne(mesh.material);
            const firstMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            if ((firstMat as THREE.MeshStandardMaterial)?.transparent) {
              mesh.receiveShadow = false;
            }
          }
        });

        separateLampLenses(scene);
        const normalized = new THREE.Group();
        normalized.add(scene);
        if (id === "mustang") exposeMustangValanceSignals(normalized);
        rigWheels(normalized, id);

        // Ground contact ambient occlusion shadow beneath chassis so cars never appear to float
        const contactMat = new THREE.MeshBasicMaterial({
          map: getAutoDetailMaps().contactShadowTex,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const contactGeo = new THREE.PlaneGeometry(size.x * 1.12, size.z * 1.06);
        contactGeo.rotateX(-Math.PI / 2);
        const contactMesh = new THREE.Mesh(contactGeo, contactMat);
        contactMesh.name = "underbody_contact_shadow";
        contactMesh.position.set(0, 0.025, 0);
        contactMesh.renderOrder = 1;
        normalized.add(contactMesh);

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

  create(id: TrafficId, opts: { paint?: number; player?: boolean; custom?: Partial<CarCustomConfig> } = {}): THREE.Group | null {
    const source = this.models.get(id);
    if (!source) return null;
    const paint = opts.paint;
    const inner = source.scene.clone(true);
    const wrapper = new THREE.Group();
    wrapper.name = `${id}_wrapper`;
    wrapper.add(inner);

    const lightCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const headlightCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const paintCopies = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
    const rimCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const glassCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const trimCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const headlightIndicators: THREE.MeshStandardMaterial[] = [];
    const indicatorCopies: THREE.MeshStandardMaterial[] = [];
    const brakeIndicatorCopies: THREE.MeshStandardMaterial[] = [];
    const signal: IndicatorUniforms = { left: { value: 0 }, right: { value: 0 }, viewZ: { value: 1 }, brake: { value: 0 } };

    wrapper.updateMatrixWorld(true);
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name === "underbody_contact_shadow") {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        return;
      }
      const isTransparentMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.transparent;
      mesh.castShadow = !!opts.player;
      mesh.receiveShadow = !isTransparentMat;
      const recolor = (mat: THREE.Material) => {
        if (isCarId(id) && (isIndicatorMaterial(id, mat) || isFrontIndicatorMaterial(id, mat))) {
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
        if (opts.player && mat.name.startsWith("paint__")) {
          let copy = paintCopies.get(mat);
          if (!copy) {
            const src = mat as THREE.MeshPhysicalMaterial;
            const baseCol = src.color?.clone?.() ?? new THREE.Color(0x94a3b8);
            copy = src.clone();
            if (paint !== undefined) copy.color.setHex(paint);
            copy.userData.defaultColor = baseCol.getHex();
            paintCopies.set(mat, copy);
          }
          return copy;
        }
        if (opts.player && mat.name.startsWith("rim__")) {
          let copy = rimCopies.get(mat);
          if (!copy) {
            copy = mat.clone() as THREE.MeshStandardMaterial;
            copy.userData.defaultColor = copy.color.getHex();
            rimCopies.set(mat, copy);
          }
          return copy;
        }
        if (opts.player && mat.name.startsWith("glass__")) {
          let copy = glassCopies.get(mat);
          if (!copy) {
            copy = mat.clone() as THREE.MeshStandardMaterial;
            glassCopies.set(mat, copy);
          }
          return copy;
        }
        if (opts.player && (mat.name.startsWith("trim__") || mat.name.startsWith("carbon__"))) {
          let copy = trimCopies.get(mat);
          if (!copy) {
            copy = mat.clone() as THREE.MeshStandardMaterial;
            copy.userData.defaultColor = copy.color.getHex();
            trimCopies.set(mat, copy);
          }
          return copy;
        }
        if (mat.name.startsWith("paint__") && paint !== undefined) {
          const key = `${mat.uuid}:${paint}`;
          let cached = this.paintCache.get(key);
          if (!cached) {
            const clone = (mat as THREE.MeshPhysicalMaterial).clone();
            clone.color.setHex(paint);
            cached = clone;
            this.paintCache.set(key, cached);
          }
          return cached;
        }
        return mat;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolor) : recolor(mesh.material);
    });

    const wheels: THREE.Group[] = [];
    const doors: THREE.Object3D[] = [];
    inner.traverse((o) => {
      if (o.name.startsWith("wheel_pivot_")) wheels.push(o as THREE.Group);
      if (/^door_(fl|fr|rl|rr)$/.test(o.name)) doors.push(o);
    });

    // Identify ONLY the single front driver-side door (-X in wrapper space, closest to -Z front)
    // and compute its outward Y-swing sign from its hinge pivot and mesh centroid.
    wrapper.updateMatrixWorld(true);
    const invWrapper = new THREE.Matrix4().copy(wrapper.matrixWorld).invert();
    let driverDoor: THREE.Object3D | null = null;
    let driverDoorSign = -1;
    let bestScore = Infinity;
    const tmpBox = new THREE.Box3();
    const tmpPt = new THREE.Vector3();
    const tmpCenter = new THREE.Vector3();
    for (const door of doors) {
      door.getWorldPosition(tmpPt).applyMatrix4(invWrapper);
      tmpBox.makeEmpty();
      door.traverse((child) => {
        const cm = child as THREE.Mesh;
        if (!cm.isMesh || !cm.geometry) return;
        if (!cm.geometry.boundingBox) cm.geometry.computeBoundingBox();
        if (!cm.geometry.boundingBox) return;
        const m = new THREE.Matrix4().multiplyMatrices(invWrapper, cm.matrixWorld);
        const bb = cm.geometry.boundingBox.clone().applyMatrix4(m);
        tmpBox.union(bb);
      });
      if (tmpBox.isEmpty()) continue;
      tmpBox.getCenter(tmpCenter);
      const score = (tmpPt.x < 0 ? 0 : 10) + tmpCenter.z;
      if (score < bestScore) {
        bestScore = score;
        driverDoor = door;
        const outX = Math.sign(tmpPt.x) || -1;
        const armZ = tmpCenter.z - tmpPt.z;
        driverDoorSign = Math.sign(outX * armZ) || -1;
      }
    }

    wrapper.userData.wheels = wheels;
    wrapper.userData.driverDoor = driverDoor;
    wrapper.userData.driverDoorSign = driverDoorSign;
    wrapper.userData.brakeMaterials = [...lightCopies.values(), ...brakeIndicatorCopies];
    wrapper.userData.headlightMaterials = [...headlightCopies.values(), ...headlightIndicators];
    wrapper.userData.indicatorMaterials = indicatorCopies;
    wrapper.userData.indicatorState = signal;
    wrapper.userData.paintMaterials = [...paintCopies.values()];
    wrapper.userData.rimMaterials = [...rimCopies.values()];
    wrapper.userData.glassMaterials = [...glassCopies.values()];
    wrapper.userData.trimMaterials = [...trimCopies.values()];
    if (opts.custom) {
      applyCarCustomization(wrapper, { ...DEFAULT_CAR_CUSTOM, ...opts.custom });
    }
    return wrapper;
  }
}

export function applyCarCustomization(carRoot: THREE.Object3D, custom: CarCustomConfig): void {
  const paintMats = carRoot.userData?.paintMaterials as THREE.MeshPhysicalMaterial[] | undefined;
  if (paintMats) {
    for (const m of paintMats) {
      if (custom.paintHex) m.color.set(custom.paintHex);
      else if (typeof m.userData.defaultColor === "number") m.color.setHex(m.userData.defaultColor);

      if (custom.paintFinish === "matte") {
        m.metalness = 0.12;
        m.roughness = 0.78;
        m.clearcoat = 0.0;
        m.clearcoatRoughness = 0.8;
        m.envMapIntensity = 0.65;
      } else if (custom.paintFinish === "gloss") {
        m.metalness = 0.16;
        m.roughness = 0.12;
        m.clearcoat = 1.0;
        m.clearcoatRoughness = 0.05;
        m.envMapIntensity = 1.5;
      } else if (custom.paintFinish === "chrome") {
        m.metalness = 0.96;
        m.roughness = 0.08;
        m.clearcoat = 0.9;
        m.clearcoatRoughness = 0.04;
        m.envMapIntensity = 1.85;
      } else {
        // metallic
        m.metalness = 0.46;
        m.roughness = 0.21;
        m.clearcoat = 1.0;
        m.clearcoatRoughness = 0.06;
        m.envMapIntensity = 1.45;
      }
      m.needsUpdate = true;
    }
  }

  const rimMats = carRoot.userData?.rimMaterials as THREE.MeshStandardMaterial[] | undefined;
  if (rimMats) {
    for (const m of rimMats) {
      m.color.set(custom.rimColor);
      m.metalness = 0.88;
      m.roughness = 0.18;
      m.envMapIntensity = 1.45;
      m.needsUpdate = true;
    }
  }

  const glassMats = carRoot.userData?.glassMaterials as THREE.MeshStandardMaterial[] | undefined;
  if (glassMats) {
    const tint = Math.max(0, Math.min(1, custom.windowTint));
    for (const m of glassMats) {
      m.opacity = 0.48 + tint * 0.44;
      m.color.setHex(tint > 0.5 ? 0x05080d : 0x090f17);
      m.envMapIntensity = 1.9;
      m.needsUpdate = true;
    }
  }

  const trimMats = carRoot.userData?.trimMaterials as THREE.MeshStandardMaterial[] | undefined;
  if (trimMats) {
    for (const m of trimMats) {
      if (custom.trimFinish === "chrome") {
        m.color.setHex(0xdbe2ea);
        m.metalness = 0.92;
        m.roughness = 0.16;
      } else if (custom.trimFinish === "carbon") {
        m.color.setHex(0x1f242c);
        m.metalness = 0.35;
        m.roughness = 0.34;
      } else if (custom.trimFinish === "bronze") {
        m.color.setHex(0x9a7549);
        m.metalness = 0.72;
        m.roughness = 0.32;
      } else {
        m.color.setHex(0x16191f);
        m.metalness = 0.14;
        m.roughness = 0.55;
      }
      m.needsUpdate = true;
    }
  }
}

export function setDoorsOpen(carRoot: THREE.Object3D, amount: number): void {
  const clamped = Math.max(0, Math.min(1, amount));
  const maxRad = (62 * Math.PI) / 180;
  let handled = false;
  carRoot.traverse((obj) => {
    const door = obj.userData?.driverDoor as THREE.Object3D | null | undefined;
    if (door) {
      const sign = typeof obj.userData.driverDoorSign === "number" ? obj.userData.driverDoorSign : -1;
      door.rotation.y = sign * maxRad * clamped;
      handled = true;
    }
  });
  if (!handled) {
    const fallback = carRoot.getObjectByName("door_fl");
    if (fallback) fallback.rotation.y = -maxRad * clamped;
  }
}
