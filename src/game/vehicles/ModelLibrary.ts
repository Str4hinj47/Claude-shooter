import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeVertices, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LoopSubdivision } from "three-subdivide";
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

const FERRARI_SKEW = 0;
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
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const matName = Array.isArray(mesh.material) ? "" : mesh.material.name || "";
      // Upgraded GLBs already carry prefixed material names (paint__, tire__, rim__, headlight__, taillight__, brake__, glass__, trim__, plate__)
      if (/^(paint|glass|headlight|taillight|tire|rim|brake|trim|plate)__/i.test(matName)) return;
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
      const matName = mesh.material.name || "";
      if (/^(paint|glass|headlight|taillight|tire|rim|brake|trim|plate)__/i.test(matName)) return;
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
      const matName = mesh.material.name || "";
      if (/^(paint|glass|headlight|taillight|tire|rim|brake|trim|plate|chrome)__/i.test(matName)) return;
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
  plateTex: THREE.Texture;
}

let cachedAutoMaps: AutoDetailMaps | null = null;
function getAutoDetailMaps(): AutoDetailMaps {
  if (cachedAutoMaps) return cachedAutoMaps;

  const makeNoise = (size: number, repeat: number, fn: (u: number, v: number) => number) => {
    const data = new Uint8Array(size * size * 4);
    const inv = (Math.PI * 2) / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const val = Math.max(0, Math.min(255, Math.round(fn(x * inv, y * inv) * 255)));
        const i = (y * size + x) * 4;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 16;
    tex.needsUpdate = true;
    return tex;
  };

  // High-resolution smooth automotive metallic micro-flake variation (512px trilinear, zero pixelation)
  const flakeRoughness = makeNoise(512, 16, (u, v) => {
    const n1 = Math.sin(u * 32 + Math.cos(v * 29) * 0.8) * 0.018;
    const n2 = Math.cos(v * 47 - Math.sin(u * 41) * 0.7) * 0.015;
    const n3 = Math.sin((u + v) * 64) * 0.01;
    return 0.19 + n1 + n2 + n3;
  });

  // High-resolution vulcanized tire tread & sidewall grain
  const treadRoughness = makeNoise(512, 12, (u, v) => {
    const rib = Math.sin(u * 24) > 0.45 ? 0.09 : 0;
    const diag = Math.sin((u * 12 + v * 12)) > 0.55 ? 0.06 : 0;
    const grain = Math.sin(u * 53 + v * 37) * 0.025 + Math.cos(u * 71 - v * 61) * 0.02;
    return 0.80 + rib - diag + grain;
  });

  // Fine 2x2 carbon / satin polymer trim weave (smooth antialiased wave, zero blocky texels)
  const carbonRoughness = makeNoise(512, 18, (u, v) => {
    const twill = Math.sin(u * 32 + v * 32) * 0.065 + Math.cos(u * 32 - v * 32) * 0.025;
    return 0.42 + twill;
  });

  // High-res soft under-chassis ambient contact shadow texture
  const sz = 512;
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
  contactShadowTex.magFilter = THREE.LinearFilter;
  contactShadowTex.minFilter = THREE.LinearMipmapLinearFilter;
  contactShadowTex.generateMipmaps = true;
  contactShadowTex.anisotropy = 16;
  contactShadowTex.needsUpdate = true;

  // Crisp embossed "WESTGATE" Bay State license plate texture
  let plateTex: THREE.Texture;
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 256);
    bgGrad.addColorStop(0, "#eef2f6");
    bgGrad.addColorStop(0.55, "#e2e8f0");
    bgGrad.addColorStop(1, "#cbd5e1");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 512, 256);

    // Subtle recessed outer frame bevel
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 496, 240);

    // Top navy Westgate header bar
    ctx.fillStyle = "#0f274c";
    ctx.fillRect(14, 14, 484, 54);
    ctx.fillStyle = "#f59e0b";
    ctx.font = "900 30px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("WESTGATE", 256, 42);

    // Corner mounting bolts
    for (const [bx, by] of [[38, 40], [474, 40], [38, 218], [474, 218]]) {
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Embossed plate registration characters
    ctx.font = "900 108px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(15, 23, 42, 0.22)";
    ctx.fillText("WGT•742", 259, 149);
    ctx.fillStyle = "#0f2240";
    ctx.fillText("WGT•742", 256, 145);

    // Bottom state strip
    ctx.fillStyle = "#b91c1c";
    ctx.font = "800 20px system-ui, -apple-system, sans-serif";
    ctx.fillText("BAY STATE", 256, 224);

    const canvasTex = new THREE.CanvasTexture(c);
    canvasTex.colorSpace = THREE.SRGBColorSpace;
    canvasTex.anisotropy = 16;
    canvasTex.needsUpdate = true;
    plateTex = canvasTex;
  } else {
    plateTex = new THREE.DataTexture(new Uint8Array([228, 232, 238, 255]), 1, 1, THREE.RGBAFormat);
    plateTex.needsUpdate = true;
  }

  cachedAutoMaps = { flakeRoughness, treadRoughness, carbonRoughness, contactShadowTex, plateTex };
  return cachedAutoMaps;
}

function tuneAutomotiveMaterial(orig: THREE.Material, id: TrafficId): THREE.Material {
  const std = orig as THREE.MeshStandardMaterial;
  const maps = getAutoDetailMaps();
  const name = orig.name || "";

  for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap, std.emissiveMap]) {
    if (tex) {
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 16;
      tex.needsUpdate = true;
    }
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
    if (/cover|glass/i.test(name)) {
      const glassCover = new THREE.MeshPhysicalMaterial({
        name,
        color: new THREE.Color(id === "golf" ? 0xb9cbd2 : 0xdbe7f3),
        metalness: 0.08,
        roughness: 0.04,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        envMapIntensity: 1.85,
      });
      return glassCover;
    } else if (name === "headlight__police_beacon_blue") {
      std.color.setHex(0x2563eb);
      std.emissive = new THREE.Color(0x3b82f6);
      std.emissiveIntensity = 1.65;
    } else if (name === "headlight__police_beacon_white") {
      std.color.setHex(0xf8fafc);
      std.emissive = new THREE.Color(0xf8fafc);
      std.emissiveIntensity = 1.35;
    } else {
      std.emissive = new THREE.Color(0xf6f9ff);
      std.emissiveIntensity = id === "golf" ? 0.35 : 0.85;
    }
  } else if (name.startsWith("taillight__")) {
    if (/cover/i.test(name)) {
      const rubyCover = new THREE.MeshPhysicalMaterial({
        name,
        color: new THREE.Color(0x9e0a10),
        metalness: 0.08,
        roughness: 0.06,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        envMapIntensity: 1.6,
      });
      return rubyCover;
    }
    std.emissive = new THREE.Color(0xff2020);
    std.emissiveIntensity = name === "taillight__police_beacon_red" ? 1.65 : 0.85;
  } else if (name.startsWith("rim__")) {
    std.metalness = 0.88;
    std.roughness = 0.18;
    std.envMapIntensity = 1.45;
    if (id === "r8") std.side = THREE.DoubleSide;
  } else if (name.startsWith("brake__")) {
    const isDisc = /disc|disk|pad2|brake-discs/i.test(name);
    std.metalness = isDisc ? 0.90 : 0.55;
    std.roughness = isDisc ? 0.22 : 0.32;
    std.envMapIntensity = isDisc ? 1.40 : 1.25;
  } else if (name.startsWith("plate__")) {
    if (!std.map) {
      std.map = maps.plateTex;
      std.color.setHex(0xffffff);
    }
    std.metalness = 0.34;
    std.roughness = 0.28;
    std.envMapIntensity = 1.15;
  } else if (name.startsWith("trim__") || name.startsWith("carbon__")) {
    if (!std.map && !name.endsWith("_livery") && std.color) {
      const lum = std.color.r * 0.299 + std.color.g * 0.587 + std.color.b * 0.114;
      if (lum > 0.72) std.color.setHex(0x181a20);
    }
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
  const frontLenses = new Map<THREE.Material, THREE.Material>();
  const rearLenses = new Map<THREE.Material, THREE.Material>();
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
      if (y < 0.96 && z < -1.5) classes.push(1);
      else if (y < 0.88 && z > 1.85) classes.push(2);
      else classes.push(0);
    }
    const hasFront = classes.includes(1);
    const hasRear = classes.includes(2);
    if (!hasFront && !hasRear) return;

    let frontLens = frontLenses.get(mesh.material);
    if (hasFront && !frontLens) {
      const m = new THREE.MeshPhysicalMaterial({
        name: mesh.material.name + "__headlight_lens",
        color: new THREE.Color(0xe6eff8),
        metalness: 0.04,
        roughness: 0.03,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        ior: 1.52,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        envMapIntensity: 1.75,
      });
      frontLenses.set(mesh.material, m);
      frontLens = m;
    }

    let rearLens = rearLenses.get(mesh.material);
    if (hasRear && !rearLens) {
      const m = new THREE.MeshPhysicalMaterial({
        name: mesh.material.name + "__taillight_lens",
        color: new THREE.Color(0x9e0a10),
        metalness: 0.08,
        roughness: 0.05,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        ior: 1.5,
        transparent: true,
        opacity: 0.40,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        envMapIntensity: 1.65,
      });
      rearLenses.set(mesh.material, m);
      rearLens = m;
    }

    const mats: THREE.Material[] = [mesh.material];
    const slotOf = [0, 0, 0];
    if (hasFront && frontLens) {
      slotOf[1] = mats.length;
      mats.push(frontLens);
    }
    if (hasRear && rearLens) {
      slotOf[2] = mats.length;
      mats.push(rearLens);
    }

    const copy = geometry.clone();
    copy.clearGroups();
    let start = 0;
    let previous = slotOf[classes[0]];
    for (let i = 1; i <= classes.length; i++) {
      const cur = i < classes.length ? slotOf[classes[i]] : -1;
      if (i === classes.length || cur !== previous) {
        copy.addGroup(start * 3, (i - start) * 3, previous);
        start = i;
        previous = cur;
      }
    }
    mesh.geometry = copy;
    mesh.material = mats;
  });
}

function exposeMustangValanceSignals(root: THREE.Group) {
  root.updateMatrixWorld(true);
  let mesh: THREE.Mesh | undefined;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!mesh && m.isMesh && !Array.isArray(m.material) && m.material.name === "headlight__M_HeadLight2") {
      mesh = m;
    }
  });
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

const LOW_POLY_SUBDIVIDE_VEHICLES = new Set<TrafficId>([
  "compact",
  "hatch",
  "crossover",
  "taxi",
  "police_cruiser",
  "van",
  "delivery",
  "garbage_truck",
  "ambulance",
  "firetruck",
]);

function upgradeVehicleMeshResolution(mesh: THREE.Mesh, id: TrafficId): void {
  let geo = mesh.geometry;
  if (!geo?.attributes?.position) return;

  const triCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  const matName = Array.isArray(mesh.material) ? (mesh.material[0]?.name ?? "") : (mesh.material?.name ?? "");
  const isWheel = /wheel|tire|rim/i.test(mesh.name) || /^(tire|rim)__/i.test(matName);
  const shouldSubdivide =
    (LOW_POLY_SUBDIVIDE_VEHICLES.has(id) && triCount > 0 && triCount <= 6000) ||
    (isWheel && triCount > 0 && triCount <= 1200);

  if (shouldSubdivide) {
    try {
      const iters = isWheel && triCount < 450 ? 2 : 1;
      const nonIdx = geo.index ? geo.toNonIndexed() : geo.clone();
      // Keep position, UV, and color (strip faceted normals so adjacent curved faces weld cleanly)
      const clean = new THREE.BufferGeometry();
      for (const attrName of ["position", "uv", "uv1", "color"]) {
        const attr = nonIdx.getAttribute(attrName);
        if (attr) clean.setAttribute(attrName, attr);
      }
      const welded = mergeVertices(clean, 1e-4);
      const sub = LoopSubdivision.modify(welded, iters, {
        split: false,
        uvSmooth: true,
        preserveEdges: true,
        flatOnly: false,
      });
      mesh.geometry = toCreasedNormals(sub, (42 * Math.PI) / 180);
      geo = mesh.geometry;
    } catch {
      // Fallback to high-precision normals if a mesh has degenerate topology
    }
  }

  // Upgrade quantized 8-bit/16-bit GLB normals to full Float32 smooth/creased normals
  const norm = geo.getAttribute("normal");
  if (norm && (norm.array instanceof Int8Array || norm.array instanceof Int16Array)) {
    try {
      mesh.geometry = toCreasedNormals(geo, (44 * Math.PI) / 180);
      geo = mesh.geometry;
    } catch {
      geo.computeVertexNormals();
    }
  }

  // Generate clean triplanar/box-projected UVs for meshes lacking TEXCOORD_0
  // so procedural paint micro-flake, tire tread grain, and carbon weave maps render properly
  if (!geo.getAttribute("uv") && /^(paint|tire|trim|carbon)__/i.test(matName)) {
    const pos = geo.getAttribute("position");
    const nrm = geo.getAttribute("normal");
    if (pos) {
      const uvs = new Float32Array(pos.count * 2);
      const scale = matName.startsWith("tire__") ? 1.8 : 0.75;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const nx = nrm ? Math.abs(nrm.getX(i)) : 0;
        const ny = nrm ? Math.abs(nrm.getY(i)) : 1;
        const nz = nrm ? Math.abs(nrm.getZ(i)) : 0;
        if (ny >= nx && ny >= nz) {
          uvs[i * 2] = x * scale;
          uvs[i * 2 + 1] = z * scale;
        } else if (nx >= nz) {
          uvs[i * 2] = z * scale;
          uvs[i * 2 + 1] = y * scale;
        } else {
          uvs[i * 2] = x * scale;
          uvs[i * 2 + 1] = y * scale;
        }
      }
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    }
  }
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
            upgradeVehicleMeshResolution(mesh, id);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = true;
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
    const caliperCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const brakeDiscCopies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
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
        if (mat.name.startsWith("taillight__") && !/cover/i.test(mat.name)) {
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
        if (opts.player && /brake__(?:.*(?:caliper|pad1)|Brakes|Brake Kit|Breaks)/i.test(mat.name)) {
          let copy = caliperCopies.get(mat);
          if (!copy) {
            copy = mat.clone() as THREE.MeshStandardMaterial;
            copy.userData.defaultColor = copy.color.getHex();
            caliperCopies.set(mat, copy);
          }
          return copy;
        }
        if (
          opts.player &&
          (/brake__.*(?:disc|disk|pad2|brake-discs)/i.test(mat.name) || /carbon disk brake/i.test(mat.name))
        ) {
          let copy = brakeDiscCopies.get(mat);
          if (!copy) {
            copy = mat.clone() as THREE.MeshStandardMaterial;
            brakeDiscCopies.set(mat, copy);
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
    wrapper.userData.caliperMaterials = [...caliperCopies.values()];
    wrapper.userData.brakeDiscMaterials = [...brakeDiscCopies.values()];
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

  const caliperMats = carRoot.userData?.caliperMaterials as THREE.MeshStandardMaterial[] | undefined;
  if (caliperMats) {
    const lvl = Math.max(0, Math.min(3, Math.round(custom.brakeLevel)));
    const caliperHex = [0x3b4252, 0xdc2626, 0xf59e0b, 0x06b6d4][lvl];
    for (const m of caliperMats) {
      m.color.setHex(caliperHex);
      m.metalness = lvl >= 2 ? 0.72 : 0.48;
      m.roughness = lvl >= 2 ? 0.22 : 0.34;
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
