import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { materialFor } from "../kit/surface";
import type { PropBatcher } from "./PropBatcher";
import type { RoadNetwork } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import { getDistrictAt } from "./WestgateTerrain";
import type { WestgateTeleportSpot } from "./WestgateWorld";
import { loadInstancedPartsFromGlb } from "./PropModels";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const streetlightGlowMats: THREE.MeshStandardMaterial[] = [];

export function setStreetlightDarkness(darkness: number): void {
  const d = Math.max(0, Math.min(1, darkness));
  const intensity = 0.2 + d * 4.0;
  for (let i = 0; i < streetlightGlowMats.length; i++) {
    streetlightGlowMats[i].emissiveIntensity = intensity;
  }
}

export function registerWestgatePropPrototypes(batcher: PropBatcher): void {
  const barkMat = materialFor(0x694932, { roughness: 0.9, family: "wood", seed: 19, repeat: 2 });
  const palmCrownMat = materialFor(0x3a7a36, { roughness: 0.78, family: "grass", seed: 23, doubleSide: true });
  const oakCrownMat = materialFor(0x376d34, { roughness: 0.84, family: "grass", seed: 29, repeat: 2 });
  const darkPoleMat = materialFor(0x232931, { roughness: 0.4, metalness: 0.78, family: "metal", seed: 31 });
  const alumMat = materialFor(0x8893a0, { roughness: 0.36, metalness: 0.82, family: "metal", seed: 33 });
  const signBladeMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.52, metalness: 0.15 });
  const lampGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d4,
    emissive: 0xffd27d,
    emissiveIntensity: 0.25,
    roughness: 0.18,
  });
  streetlightGlowMats.push(lampGlowMat);
  const carPaintMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.18, metalness: 0.65 });
  const cabinGlassMat = new THREE.MeshStandardMaterial({ color: 0x0f1824, roughness: 0.08, metalness: 0.85 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.88, metalness: 0.05 });
  const alloyMat = materialFor(0xcbd5e1, { roughness: 0.25, metalness: 0.88, family: "metal", seed: 37 });
  const hydrantRed = materialFor(0xc81e1e, { roughness: 0.38, metalness: 0.42, family: "metal", seed: 41 });
  const coconutMat = materialFor(0x52361f, { roughness: 0.85, family: "wood", seed: 43 });

  // 1. California Fan / Date Palm Tree (9.2m tall, 9-segment ringed trunk, crownshaft, coconut cluster & 14 layered fronds)
  const palmTrunkSegs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const t0 = i / 9;
    const t1 = (i + 1) / 9;
    const rBot = THREE.MathUtils.lerp(0.34, 0.16, t0);
    const rTop = THREE.MathUtils.lerp(0.32, 0.15, t1);
    const seg = new THREE.CylinderGeometry(rTop, rBot, 0.96, 10);
    const leanX = Math.sin(t0 * 1.55) * 0.26;
    const leanZ = Math.cos(t0 * 1.1) * 0.08 - 0.08;
    seg.translate(leanX, i * 0.92 + 0.48, leanZ);
    palmTrunkSegs.push(seg);
  }
  const crownShaft = new THREE.CylinderGeometry(0.19, 0.16, 0.62, 10);
  crownShaft.translate(0.26, 8.45, -0.04);
  palmTrunkSegs.push(crownShaft);
  const palmTrunk = mergeGeometries(palmTrunkSegs, false);

  const coconutParts: THREE.BufferGeometry[] = [];
  for (let c = 0; c < 5; c++) {
    const a = (c / 5) * Math.PI * 2;
    const nut = new THREE.SphereGeometry(0.12, 8, 6);
    nut.scale(0.9, 1.15, 0.9);
    nut.translate(0.26 + Math.cos(a) * 0.22, 8.22, -0.04 + Math.sin(a) * 0.22);
    coconutParts.push(nut);
  }
  const palmCoconuts = mergeGeometries(coconutParts, false);

  const frondShape = new THREE.Shape();
  frondShape.moveTo(0, 0);
  frondShape.quadraticCurveTo(1.2, 0.56, 2.95, -0.45);
  frondShape.quadraticCurveTo(2.1, -0.18, 1.2, 0.02);
  frondShape.lineTo(0, -0.07);
  frondShape.closePath();
  const palmFronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const tier = i % 3; // 0: upper shoot, 1: mid arch, 2: lower droop
    const frond = new THREE.ExtrudeGeometry(frondShape, {
      depth: tier === 0 ? 0.22 : 0.28,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.025,
      bevelSegments: 1,
    });
    frond.translate(0, 0, tier === 0 ? -0.11 : -0.14);
    frond.rotateX((i % 2 === 0 ? 0.16 : -0.16));
    frond.rotateZ(tier === 0 ? 0.38 : tier === 1 ? 0.04 : -0.28);
    frond.rotateY((i / 18) * Math.PI * 2 + tier * 0.24);
    frond.translate(0.26, 8.65 + (2 - tier) * 0.18, -0.04);
    palmFronds.push(frond);
  }
  const palmCrown = mergeGeometries(palmFronds, false);
  const palmRingCurb = new THREE.CylinderGeometry(0.68, 0.72, 0.14, 12);
  palmRingCurb.translate(0, 0.07, 0);
  batcher.registerPrototype({
    id: "palm_tree",
    colliderSize: [0.65, 6.2, 0.65],
    parts: [
      { geometry: palmTrunk, material: barkMat, preserveBaseColor: true },
      { geometry: palmCoconuts, material: coconutMat, preserveBaseColor: true },
      { geometry: palmCrown, material: palmCrownMat },
      { geometry: palmRingCurb, material: alumMat, preserveBaseColor: true },
    ],
  });

  // 2. Mature Urban Oak / Sycamore Tree (root buttress, multi-bough skeleton & 9 organic foliage clusters)
  const rootFlare = new THREE.CylinderGeometry(0.36, 0.58, 0.65, 10);
  rootFlare.translate(0, 0.32, 0);
  const trunkBase = new THREE.CylinderGeometry(0.25, 0.37, 2.9, 10);
  trunkBase.translate(0, 1.9, 0);
  const boughs: Array<[number, number, number, number, number, number, number]> = [
    [-0.48, 3.45, 0.15, 0.48, 0.2, 1.9, 0.16],
    [0.44, 3.55, -0.18, -0.44, 0.9, 1.85, 0.15],
    [0.12, 3.65, 0.45, 0.38, -1.2, 1.7, 0.14],
    [-0.18, 3.7, -0.42, -0.36, 2.1, 1.65, 0.13],
  ];
  const branchGeos = boughs.map(([bx, by, bz, rz, ry, len, rad]) => {
    const b = new THREE.CylinderGeometry(rad * 0.65, rad, len, 8);
    b.rotateZ(rz);
    b.rotateY(ry);
    b.translate(bx, by, bz);
    return b;
  });
  const oakTrunk = mergeGeometries([rootFlare, trunkBase, ...branchGeos], false);

  const canopyClusters: Array<[number, number, number, number, number, number]> = [
    [0, 4.75, 0, 1.9, 1.4, 1.9],
    [1.18, 4.9, -0.58, 1.38, 1.15, 1.34],
    [-1.15, 4.65, 0.58, 1.4, 1.1, 1.38],
    [0.36, 4.6, 1.18, 1.32, 1.06, 1.28],
    [-0.48, 4.85, -1.16, 1.32, 1.1, 1.28],
    [0.18, 5.8, 0.22, 1.32, 1.02, 1.28],
    [-0.82, 5.58, -0.34, 1.08, 0.92, 1.08],
    [0.88, 5.52, 0.48, 1.05, 0.9, 1.05],
    [0.05, 6.3, -0.12, 0.88, 0.75, 0.88],
    [-0.95, 4.4, -0.82, 1.05, 0.88, 1.05],
    [0.95, 4.45, 0.82, 1.05, 0.86, 1.02],
  ];
  const oakFoliageParts = canopyClusters.map(([cx, cy, cz, sx, sy, sz], idx) => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const vx = p.getX(k);
      const vy = p.getY(k);
      const vz = p.getZ(k);
      const bump = 1 + 0.09 * Math.sin(vx * 5.4 + vy * 3.9 + idx) * Math.cos(vz * 4.7 - idx * 0.7);
      p.setXYZ(k, vx * sx * bump, vy * sy * bump, vz * sz * bump);
    }
    g.computeVertexNormals();
    g.translate(cx, cy, cz);
    return g;
  });
  const oakCanopy = mergeGeometries(oakFoliageParts, false);
  const oakGrate = new THREE.BoxGeometry(1.42, 0.06, 1.42);
  oakGrate.translate(0, 0.03, 0);
  batcher.registerPrototype({
    id: "oak_tree",
    colliderSize: [0.85, 4.6, 0.85],
    parts: [
      { geometry: oakTrunk, material: barkMat, preserveBaseColor: true },
      { geometry: oakCanopy, material: oakCrownMat },
      { geometry: oakGrate, material: darkPoleMat, preserveBaseColor: true },
    ],
  });

  // 3. Detailed Architectural Streetlight (fluted base plinth, tapered mast, curved bracket, cobrahead hood + ped globe)
  const poleBase = new THREE.CylinderGeometry(0.22, 0.3, 0.72, 12);
  poleBase.translate(0, 0.36, 0);
  const poleCollar = new THREE.CylinderGeometry(0.18, 0.22, 0.22, 12);
  poleCollar.translate(0, 0.82, 0);
  const poleShaft = new THREE.CylinderGeometry(0.085, 0.14, 5.95, 10);
  poleShaft.translate(0, 3.88, 0);
  const armBracket = new THREE.BoxGeometry(2.05, 0.1, 0.12);
  armBracket.rotateZ(0.14);
  armBracket.translate(0.96, 6.72, 0);
  const gussetBrace = new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6);
  gussetBrace.rotateZ(-0.78);
  gussetBrace.translate(0.36, 6.38, 0);
  const pedArm = new THREE.BoxGeometry(0.65, 0.07, 0.08);
  pedArm.translate(-0.34, 4.2, 0);
  // Decorative boulevard banner brackets on streetlight shaft
  const bannerArmTop = new THREE.BoxGeometry(0.68, 0.05, 0.05);
  bannerArmTop.translate(0.36, 5.45, 0);
  const bannerArmBot = new THREE.BoxGeometry(0.68, 0.05, 0.05);
  bannerArmBot.translate(0.36, 4.15, 0);
  const streetPoleGeo = mergeGeometries(
    [poleBase, poleCollar, poleShaft, armBracket, gussetBrace, pedArm, bannerArmTop, bannerArmBot],
    false,
  );

  const cobraHood = new THREE.CylinderGeometry(0.22, 0.32, 0.72, 8);
  cobraHood.rotateZ(Math.PI * 0.5);
  cobraHood.scale(1, 0.36, 1.15);
  cobraHood.translate(1.94, 6.84, 0);
  const pedCap = new THREE.CylinderGeometry(0.16, 0.22, 0.12, 10);
  pedCap.translate(-0.62, 4.14, 0);
  const streetAlumGeo = mergeGeometries([cobraHood, pedCap], false);

  const cobraLens = new THREE.BoxGeometry(0.56, 0.06, 0.28);
  cobraLens.translate(1.96, 6.74, 0);
  const pedGlobe = new THREE.CylinderGeometry(0.13, 0.1, 0.24, 10);
  pedGlobe.translate(-0.62, 3.98, 0);
  const streetGlowGeo = mergeGeometries([cobraLens, pedGlobe], false);

  const bannerFabric = new THREE.BoxGeometry(0.54, 1.24, 0.04);
  bannerFabric.translate(0.4, 4.8, 0);

  batcher.registerPrototype({
    id: "streetlight",
    colliderSize: [0.38, 6.4, 0.38],
    parts: [
      { geometry: streetPoleGeo, material: darkPoleMat, preserveBaseColor: true },
      { geometry: streetAlumGeo, material: alumMat, preserveBaseColor: true },
      { geometry: streetGlowGeo, material: lampGlowMat, preserveBaseColor: true, castShadow: false },
      { geometry: bannerFabric, material: signBladeMat, preserveBaseColor: true },
    ],
  });

  // 4. Signal Intersection Mast (base flange, mast, street sign blade, twin 3-aspect visored signal heads, ped box)
  const sigBase = new THREE.CylinderGeometry(0.26, 0.32, 0.55, 12);
  sigBase.translate(0, 0.275, 0);
  const sigMast = new THREE.CylinderGeometry(0.13, 0.2, 5.75, 10);
  sigMast.translate(0, 3.15, 0);
  const sigArm = new THREE.CylinderGeometry(0.08, 0.11, 5.4, 8);
  sigArm.rotateZ(-Math.PI * 0.5);
  sigArm.translate(2.65, 5.82, 0);
  const sigBoxA = new THREE.BoxGeometry(0.42, 1.15, 0.34);
  sigBoxA.translate(3.15, 5.25, 0);
  const sigBoxB = new THREE.BoxGeometry(0.42, 1.15, 0.34);
  sigBoxB.translate(4.75, 5.25, 0);
  const pedBox = new THREE.BoxGeometry(0.24, 0.36, 0.22);
  pedBox.translate(0.18, 1.25, 0);
  const walkSignalHead = new THREE.BoxGeometry(0.34, 0.42, 0.28);
  walkSignalHead.translate(0, 2.75, 0.26);
  const sigCtrlCabinet = new THREE.BoxGeometry(0.42, 0.95, 0.34);
  sigCtrlCabinet.translate(-0.46, 0.48, 0);
  // Signal visors above each lens
  const visorParts: THREE.BufferGeometry[] = [];
  for (const sx of [3.15, 4.75]) {
    for (const sy of [5.58, 5.25, 4.92]) {
      const visor = new THREE.CylinderGeometry(0.13, 0.13, 0.26, 8, 1, true, -Math.PI * 0.5, Math.PI);
      visor.rotateX(Math.PI * 0.5);
      visor.translate(sx, sy + 0.02, 0.22);
      visorParts.push(visor);
    }
  }
  const sigMetalGeo = mergeGeometries(
    [sigBase, sigMast, sigArm, sigBoxA, sigBoxB, pedBox, walkSignalHead, sigCtrlCabinet, ...visorParts],
    false,
  );

  const streetBlade = new THREE.BoxGeometry(1.55, 0.34, 0.06);
  streetBlade.translate(1.55, 5.82, 0.1);

  // Static mast housings kept unlit so TrafficSignalManager's live phase pods control Red/Amber/Green state
  const sigRed = new THREE.MeshStandardMaterial({ color: 0x261214, emissive: 0x450a0a, emissiveIntensity: 0.08 });
  const sigAmber = new THREE.MeshStandardMaterial({ color: 0x261d10, emissive: 0x451a03, emissiveIntensity: 0.06 });
  const sigGreen = new THREE.MeshStandardMaterial({ color: 0x0f2618, emissive: 0x052e16, emissiveIntensity: 0.08 });
  const redGeo = mergeGeometries(
    [3.15, 4.75].map((sx) => {
      const g = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10);
      g.rotateX(Math.PI * 0.5);
      g.translate(sx, 5.58, 0.17);
      return g;
    }),
    false,
  );
  const ambGeo = mergeGeometries(
    [3.15, 4.75].map((sx) => {
      const g = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10);
      g.rotateX(Math.PI * 0.5);
      g.translate(sx, 5.25, 0.17);
      return g;
    }),
    false,
  );
  const grnGeo = mergeGeometries(
    [3.15, 4.75].map((sx) => {
      const g = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10);
      g.rotateX(Math.PI * 0.5);
      g.translate(sx, 4.92, 0.17);
      return g;
    }),
    false,
  );

  batcher.registerPrototype({
    id: "traffic_light",
    colliderSize: [0.48, 5.8, 0.48],
    parts: [
      { geometry: sigMetalGeo, material: darkPoleMat, preserveBaseColor: true },
      { geometry: streetBlade, material: signBladeMat, preserveBaseColor: true },
      { geometry: redGeo, material: sigRed, preserveBaseColor: true, castShadow: false },
      { geometry: ambGeo, material: sigAmber, preserveBaseColor: true, castShadow: false },
      { geometry: grnGeo, material: sigGreen, preserveBaseColor: true, castShadow: false },
    ],
  });

  // 5. Prototype 5 kept for PropBatcher registry parity (never spawned on streets)
  const stubBody = new THREE.BoxGeometry(1.8, 1.1, 4.1);
  stubBody.translate(0, 0.6, 0);
  const stubGlass = new THREE.BoxGeometry(1.5, 0.45, 1.9);
  stubGlass.translate(0, 1.2, -0.1);
  batcher.registerPrototype({
    id: "parked_car",
    colliderSize: [1.85, 1.4, 4.1],
    parts: [
      { geometry: stubBody, material: carPaintMat },
      { geometry: stubGlass, material: cabinGlassMat, preserveBaseColor: true },
      { geometry: new THREE.CylinderGeometry(0.32, 0.32, 0.24, 10), material: tireMat, localOffset: [0, 0.32, 0], preserveBaseColor: true },
    ],
  });

  // 6. Detailed Sidewalk Fire Hydrant (bolted base flange, fluted barrel, dome, pentagonal nut, side caps & steamer port)
  const hydFlange = new THREE.CylinderGeometry(0.24, 0.26, 0.08, 12);
  hydFlange.translate(0, 0.04, 0);
  const hydBody = new THREE.CylinderGeometry(0.17, 0.19, 0.72, 12);
  hydBody.translate(0, 0.42, 0);
  const hydCollar = new THREE.CylinderGeometry(0.21, 0.21, 0.07, 12);
  hydCollar.translate(0, 0.76, 0);
  const hydCap = new THREE.SphereGeometry(0.18, 12, 8);
  hydCap.translate(0, 0.8, 0);
  const hydRedGeo = mergeGeometries([hydFlange, hydBody, hydCollar, hydCap], false);

  const hydNut = new THREE.CylinderGeometry(0.05, 0.06, 0.09, 5);
  hydNut.translate(0, 1.0, 0);
  const hydSideNozzle = new THREE.CylinderGeometry(0.055, 0.055, 0.46, 10);
  hydSideNozzle.rotateZ(Math.PI * 0.5);
  hydSideNozzle.translate(0, 0.58, 0);
  const hydFrontNozzle = new THREE.CylinderGeometry(0.075, 0.075, 0.24, 10);
  hydFrontNozzle.rotateX(Math.PI * 0.5);
  hydFrontNozzle.translate(0, 0.52, 0.13);
  const hydBrassGeo = mergeGeometries([hydNut, hydSideNozzle, hydFrontNozzle], false);

  batcher.registerPrototype({
    id: "hydrant",
    colliderSize: [0.44, 1.05, 0.44],
    parts: [
      { geometry: hydRedGeo, material: hydrantRed, preserveBaseColor: true },
      { geometry: hydBrassGeo, material: alloyMat, preserveBaseColor: true },
    ],
  });

  // 7. Foothills Conifer Pine Tree (upgraded in browser to tree_pine.glb)
  const pineTrunk = new THREE.CylinderGeometry(0.18, 0.34, 2.4, 8);
  pineTrunk.translate(0, 1.2, 0);
  const pineTier1 = new THREE.ConeGeometry(1.75, 2.8, 9);
  pineTier1.translate(0, 3.2, 0);
  const pineTier2 = new THREE.ConeGeometry(1.35, 2.5, 9);
  pineTier2.translate(0, 4.7, 0);
  const pineTier3 = new THREE.ConeGeometry(0.9, 2.1, 9);
  pineTier3.translate(0, 6.1, 0);
  const pineCanopy = mergeGeometries([pineTier1, pineTier2, pineTier3], false);
  batcher.registerPrototype({
    id: "pine_tree",
    colliderSize: [0.7, 5.2, 0.7],
    parts: [
      { geometry: pineTrunk, material: barkMat, preserveBaseColor: true },
      { geometry: pineCanopy, material: oakCrownMat },
    ],
  });

  // 8. Roadside / Park Shrub Bush (upgraded in browser to bush.glb)
  const bushGeo = new THREE.IcosahedronGeometry(0.68, 1);
  bushGeo.scale(1.15, 0.85, 1.05);
  bushGeo.translate(0, 0.52, 0);
  batcher.registerPrototype({
    id: "bush",
    parts: [{ geometry: bushGeo, material: oakCrownMat }],
  });

  // 9. Foothills / Coastal Rock Boulder (upgraded in browser to rock.glb)
  const rockGeo = new THREE.DodecahedronGeometry(0.65, 0);
  rockGeo.scale(1.25, 0.85, 1.05);
  rockGeo.translate(0, 0.42, 0);
  const rockMat = materialFor(0x78716c, { roughness: 0.92, family: "stone", seed: 51 });
  batcher.registerPrototype({
    id: "rock",
    parts: [{ geometry: rockGeo, material: rockMat }],
  });

  // 10. Park / Boardwalk / Plaza Bench (upgraded in browser to park_bench.glb)
  const benchSeat = new THREE.BoxGeometry(1.65, 0.1, 0.56);
  benchSeat.translate(0, 0.46, 0);
  const benchBack = new THREE.BoxGeometry(1.65, 0.44, 0.08);
  benchBack.translate(0, 0.74, -0.24);
  const benchWood = mergeGeometries([benchSeat, benchBack], false);
  const benchLegL = new THREE.BoxGeometry(0.1, 0.46, 0.52);
  benchLegL.translate(-0.7, 0.23, 0);
  const benchLegR = new THREE.BoxGeometry(0.1, 0.46, 0.52);
  benchLegR.translate(0.7, 0.23, 0);
  const benchLegs = mergeGeometries([benchLegL, benchLegR], false);
  batcher.registerPrototype({
    id: "park_bench",
    colliderSize: [1.65, 0.95, 0.62],
    parts: [
      { geometry: benchWood, material: barkMat, preserveBaseColor: true },
      { geometry: benchLegs, material: darkPoleMat, preserveBaseColor: true },
    ],
  });

  // 11. Sidewalk Metal Trash Can (upgraded in browser to trashcan_metal.glb)
  const canGeo = new THREE.CylinderGeometry(0.28, 0.25, 0.95, 10);
  canGeo.translate(0, 0.48, 0);
  batcher.registerPrototype({
    id: "trashcan",
    colliderSize: [0.58, 0.98, 0.58],
    parts: [{ geometry: canGeo, material: darkPoleMat, preserveBaseColor: true }],
  });

  // 12. Commercial / Alley Dumpster (upgraded in browser to dumpster_bin.glb)
  const dumpGeo = new THREE.BoxGeometry(1.65, 1.35, 1.15);
  dumpGeo.translate(0, 0.68, 0);
  const dumpMat = materialFor(0x166534, { roughness: 0.72, metalness: 0.25, family: "metal", seed: 59 });
  batcher.registerPrototype({
    id: "dumpster",
    colliderSize: [1.65, 1.35, 1.15],
    parts: [{ geometry: dumpGeo, material: dumpMat, preserveBaseColor: true }],
  });

  // 13. Side-Street Stop Sign (upgraded in browser to sign_stop.glb)
  const stopPost = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6);
  stopPost.translate(0, 1.1, 0);
  const stopOct = new THREE.CylinderGeometry(0.38, 0.38, 0.05, 8);
  stopOct.rotateX(Math.PI * 0.5);
  stopOct.translate(0, 2.15, 0);
  batcher.registerPrototype({
    id: "stop_sign",
    colliderSize: [0.3, 2.4, 0.3],
    parts: [
      { geometry: stopPost, material: alumMat, preserveBaseColor: true },
      { geometry: stopOct, material: hydrantRed, preserveBaseColor: true },
    ],
  });
}

export interface StreetlightPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Populates citywide street furniture, district-themed trees, traffic signals,
 * and hydrants into `PropBatcher` (all strictly off-carriageway).
 * Returns elevated lamp bulb positions for pooled real night streetlights.
 */
export function populateWestgateProps(
  batcher: PropBatcher,
  roads: RoadNetwork,
  terrainAt: TerrainHeightFn,
  teleports: readonly WestgateTeleportSpot[],
): StreetlightPoint[] {
  registerWestgatePropPrototypes(batcher);
  const rng = mulberry32(20261122);
  const streetlightPoints: StreetlightPoint[] = [];

  const isNearTeleport = (x: number, z: number, minDist = 8.5): boolean => {
    for (let i = 0; i < teleports.length; i++) {
      const tp = teleports[i];
      if ((x - tp.x) * (x - tp.x) + (z - tp.z) * (z - tp.z) < minDist * minDist) return true;
    }
    return false;
  };

  // Track placed poles/trees on a coarse 5.5m grid so crossing roads don't double-place
  const occupied = new Set<string>();
  const tryReserve = (x: number, z: number): boolean => {
    const key = `${Math.round(x / 5.5)},${Math.round(z / 5.5)}`;
    if (occupied.has(key)) return false;
    occupied.add(key);
    return true;
  };

  // 1. Streetlights & District Trees along Arterial / Collector / Local curbs
  for (const seg of roads.getSegments()) {
    if (seg.spec.isBridge || seg.spec.tier === "freeway" || seg.spec.tier === "ramp") continue;
    const samples = seg.samples;
    if (samples.length < 4) continue;

    const halfW = seg.totalWidth * 0.5;
    let nextLampS = 18;
    let nextTreeS = 12;
    let lampSide = 1;

    for (let i = 1; i < samples.length - 1; i++) {
      const sp = samples[i];
      // Streetlights alternating/paired along road curbs (dense urban spacing)
      if (sp.s >= nextLampS) {
        nextLampS = sp.s + (seg.spec.tier === "arterial" ? 20 : seg.spec.tier === "collector" ? 24 : 26);
        for (const side of seg.spec.tier === "arterial" ? [-1, 1] : [lampSide]) {
          const lx = sp.x + sp.rx * (halfW + 0.85) * side;
          const lz = sp.z + sp.rz * (halfW + 0.85) * side;
          const gy = terrainAt(lx, lz);
          if (gy >= 2.0 && !isNearTeleport(lx, lz) && tryReserve(lx, lz)) {
            const inf = roads.getRoadInfluence(lx, lz, 14, true);
            if (!inf || inf.edgeDist >= 0.4) {
              const ry = Math.atan2(sp.rz * side, -sp.rx * side);
              batcher.addInstance("streetlight", { x: lx, y: gy, z: lz, ry });
              streetlightPoints.push({
                x: lx + Math.sin(ry) * 1.4,
                y: gy + 5.7,
                z: lz + Math.cos(ry) * 1.4,
              });
            }
          }
        }
        lampSide *= -1;
      }

      // Palms & Oaks behind sidewalk apron (dense boulevard canopy)
      if (sp.s >= nextTreeS) {
        nextTreeS = sp.s + (seg.spec.tier === "arterial" ? 13.5 : seg.spec.tier === "collector" ? 15 : 17);
        const treeSides = seg.spec.tier === "arterial" ? [-1, 1] : [rng() > 0.45 ? 1 : -1];
        for (const side of treeSides) {
          const tx = sp.x + sp.rx * (halfW + 3.4) * side;
          const tz = sp.z + sp.rz * (halfW + 3.4) * side;
          const gy = terrainAt(tx, tz);
          if (gy >= 2.1 && !isNearTeleport(tx, tz, 9.5) && tryReserve(tx, tz)) {
            const inf = roads.getRoadInfluence(tx, tz, 16, true);
            if (!inf || inf.edgeDist >= 2.0) {
              const dist = getDistrictAt(tx, tz).id;
              const usePalm =
                dist === "west_coast" || dist === "downtown" || dist === "south_airport" || (dist === "midtown" && rng() > 0.45);
              const usePine = dist === "foothills" && rng() < 0.55;
              const scale = 0.85 + rng() * 0.38;
              batcher.addInstance(usePalm ? "palm_tree" : usePine ? "pine_tree" : "oak_tree", {
                x: tx,
                y: gy,
                z: tz,
                ry: rng() * Math.PI * 2,
                scale,
                hueShift: (rng() - 0.5) * 0.08,
              });
            }
          }
        }
      }
    }
  }

  // 2. Signalized Intersection Traffic Lights (4-corner signal masts)
  for (const node of roads.getNodes()) {
    if (node.kind !== "signal") continue;
    for (const [ox, oz, ry] of [
      [11.5, 11.5, Math.PI * 0.75],
      [-11.5, -11.5, -Math.PI * 0.25],
      [11.5, -11.5, Math.PI * 0.25],
      [-11.5, 11.5, -Math.PI * 0.75],
    ] as const) {
      const sx = node.x + ox;
      const sz = node.z + oz;
      const gy = terrainAt(sx, sz);
      if (gy >= 2.0 && !isNearTeleport(sx, sz) && tryReserve(sx, sz)) {
        batcher.addInstance("traffic_light", { x: sx, y: gy, z: sz, ry });
      }
    }
  }

  // 3. Mirror Central Park, University Quad, Venice Canals, Foothills, Arena, Coast & Airport Groves
  const parkZones = [
    { cx: -115, cz: 395, rx: 56, rz: 52, count: 96, palmChance: 0.16, avoidCenterR: 26 },
    { cx: -165, cz: -362, rx: 44, rz: 34, count: 54, palmChance: 0.25, avoidCenterR: 15 },
    { cx: -220, cz: -790, rx: 280, rz: 110, count: 140, palmChance: 0.12, avoidCenterR: 0 },
    { cx: -640, cz: 220, rx: 88, rz: 88, count: 68, palmChance: 0.78, avoidCenterR: 18 },
    { cx: -415, cz: 615, rx: 70, rz: 55, count: 40, palmChance: 0.85, avoidCenterR: 38 },
    { cx: -700, cz: -20, rx: 32, rz: 240, count: 45, palmChance: 0.96, avoidCenterR: 0 },
    { cx: -125, cz: 880, rx: 65, rz: 32, count: 32, palmChance: 0.92, avoidCenterR: 0 },
  ];
  for (const pz of parkZones) {
    for (let i = 0; i < pz.count; i++) {
      const ox = (rng() - 0.5) * 2 * pz.rx;
      const oz = (rng() - 0.5) * 2 * pz.rz;
      if (pz.avoidCenterR > 0 && Math.hypot(ox, oz) < pz.avoidCenterR) continue;
      const tx = pz.cx + ox;
      const tz = pz.cz + oz;
      const gy = terrainAt(tx, tz);
      if (gy < 2.2 || isNearTeleport(tx, tz, 10)) continue;
      const inf = roads.getRoadInfluence(tx, tz, 18, true);
      if (inf && inf.edgeDist < 3.5) continue;
      if (!tryReserve(tx, tz)) continue;
      const dist = getDistrictAt(tx, tz).id;
      const treeProto =
        rng() < pz.palmChance
          ? "palm_tree"
          : dist === "foothills" && rng() < 0.62
            ? "pine_tree"
            : "oak_tree";
      batcher.addInstance(treeProto, {
        x: tx,
        y: gy,
        z: tz,
        ry: rng() * Math.PI * 2,
        scale: 0.85 + rng() * 0.42,
        hueShift: (rng() - 0.5) * 0.08,
      });
    }
  }

  // 3b. Park & Foothills Shrubs / Rocks + Boardwalk & Park Benches
  for (const pz of parkZones) {
    const bushCount = Math.round(pz.count * 0.45);
    for (let i = 0; i < bushCount; i++) {
      const ox = (rng() - 0.5) * 2 * pz.rx;
      const oz = (rng() - 0.5) * 2 * pz.rz;
      if (pz.avoidCenterR > 0 && Math.hypot(ox, oz) < pz.avoidCenterR) continue;
      const bx = pz.cx + ox;
      const bz = pz.cz + oz;
      const gy = terrainAt(bx, bz);
      if (gy < 2.2 || isNearTeleport(bx, bz, 9)) continue;
      const inf = roads.getRoadInfluence(bx, bz, 14, true);
      if (inf && inf.edgeDist < 2.5) continue;
      if (!tryReserve(bx, bz)) continue;
      batcher.addInstance("bush", {
        x: bx,
        y: gy,
        z: bz,
        ry: rng() * Math.PI * 2,
        scale: 0.8 + rng() * 0.45,
        hueShift: (rng() - 0.5) * 0.07,
      });
    }
  }

  // Foothills & Gorge Boulders
  for (let i = 0; i < 64; i++) {
    const rx = -460 + rng() * 880;
    const rz = -980 + rng() * 340;
    const gy = terrainAt(rx, rz);
    if (gy < 8.0 || isNearTeleport(rx, rz, 12)) continue;
    const inf = roads.getRoadInfluence(rx, rz, 16, true);
    if (inf && inf.edgeDist < 4.0) continue;
    if (!tryReserve(rx, rz)) continue;
    batcher.addInstance("rock", {
      x: rx,
      y: gy,
      z: rz,
      ry: rng() * Math.PI * 2,
      scale: 0.85 + rng() * 0.75,
    });
  }

  // Scenic Park & Boardwalk Benches (Del Sol Boardwalk, Mirror Park, Venice Canals, University Quad)
  const benchSpots: Array<{ x: number; z: number; ry: number }> = [
    // Del Sol Boardwalk overlooking ocean
    ...[-140, -100, -60, -20, 20, 60, 100, 140].map((bz) => ({ x: -708, z: bz, ry: Math.PI * 0.5 })),
    // Mirror Central Park lakefront paths
    { x: -132, z: 378, ry: Math.PI * 0.25 },
    { x: -98, z: 378, ry: -Math.PI * 0.25 },
    { x: -132, z: 412, ry: Math.PI * 0.75 },
    { x: -98, z: 412, ry: -Math.PI * 0.75 },
    // University Quad
    { x: -152, z: -346, ry: Math.PI },
    { x: -178, z: -346, ry: Math.PI },
  ];
  for (const bs of benchSpots) {
    const gy = terrainAt(bs.x, bs.z);
    if (gy >= 2.0 && !isNearTeleport(bs.x, bs.z, 6) && tryReserve(bs.x, bs.z)) {
      batcher.addInstance("park_bench", { x: bs.x, y: gy, z: bs.z, ry: bs.ry });
    }
  }

  // 4. Sidewalk Fire Hydrants, Trash Cans, Stop Signs & Commercial Dumpsters along urban arterials & collectors
  for (const node of roads.getNodes()) {
    if (node.kind === "signal") continue;
    const sx = node.x + 8.5;
    const sz = node.z + 8.5;
    const gy = terrainAt(sx, sz);
    if (gy >= 2.0 && !isNearTeleport(sx, sz, 7) && tryReserve(sx, sz)) {
      const inf = roads.getRoadInfluence(sx, sz, 12, true);
      if (!inf || inf.edgeDist >= 0.7) {
        batcher.addInstance("stop_sign", { x: sx, y: gy, z: sz, ry: 0 });
      }
    }
  }

  for (const seg of roads.getSegments()) {
    if (seg.spec.isBridge || (seg.spec.tier !== "arterial" && seg.spec.tier !== "collector")) continue;
    for (let i = 2; i < seg.samples.length - 2; i += 5) {
      const sp = seg.samples[i];
      const dist = getDistrictAt(sp.x, sp.z).id;
      if (dist !== "downtown" && dist !== "midtown" && dist !== "old_quarter" && dist !== "west_coast" && dist !== "east_port") continue;
      const hx = sp.x + sp.rx * (seg.totalWidth * 0.5 + 1.15);
      const hz = sp.z + sp.rz * (seg.totalWidth * 0.5 + 1.15);
      const gy = terrainAt(hx, hz);
      if (gy >= 2.2 && !isNearTeleport(hx, hz, 8) && tryReserve(hx, hz)) {
        const inf = roads.getRoadInfluence(hx, hz, 14, true);
        if (!inf || inf.edgeDist >= 0.7) {
          batcher.addInstance(i % 10 === 2 ? "hydrant" : "trashcan", { x: hx, y: gy, z: hz });
        }
      }
      if ((dist === "east_port" || dist === "midtown" || dist === "downtown") && i % 15 === 7) {
        const dx = sp.x - sp.rx * (seg.totalWidth * 0.5 + 4.8);
        const dz = sp.z - sp.rz * (seg.totalWidth * 0.5 + 4.8);
        const dgy = terrainAt(dx, dz);
        if (dgy >= 2.2 && !isNearTeleport(dx, dz, 10) && tryReserve(dx, dz)) {
          const dinf = roads.getRoadInfluence(dx, dz, 14, true);
          if (!dinf || dinf.edgeDist >= 2.6) {
            batcher.addInstance("dumpster", { x: dx, y: dgy, z: dz, ry: Math.atan2(sp.rz, -sp.rx) });
          }
        }
      }
    }
  }
  return streetlightPoints;
}

/**
 * Upgrades built instanced city trees & street furniture in-place to high-detail
 * self-contained Quaternius GLBs in the browser while preserving GPU instancing.
 */
export function upgradeWestgatePropsWithGlbs(batcher: PropBatcher): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;

  const specs: Array<{ proto: string; file: string; axis: "y" | "z" | "max"; meters: number }> = [
    { proto: "palm_tree", file: "tree_palm.glb", axis: "y", meters: 9.2 },
    { proto: "oak_tree", file: "tree_oak.glb", axis: "y", meters: 6.8 },
    { proto: "pine_tree", file: "tree_pine.glb", axis: "y", meters: 7.5 },
    { proto: "bush", file: "bush.glb", axis: "y", meters: 1.35 },
    { proto: "rock", file: "rock.glb", axis: "y", meters: 1.15 },
    { proto: "park_bench", file: "park_bench.glb", axis: "y", meters: 0.88 },
    { proto: "trashcan", file: "trashcan_metal.glb", axis: "y", meters: 1.02 },
    { proto: "dumpster", file: "dumpster_bin.glb", axis: "y", meters: 1.45 },
    { proto: "stop_sign", file: "sign_stop.glb", axis: "y", meters: 2.35 },
    { proto: "traffic_cone", file: "traffic_cone.glb", axis: "y", meters: 0.68 },
  ];

  for (const sp of specs) {
    void loadInstancedPartsFromGlb(sp.file, sp.axis, sp.meters, 0).then((parts) => {
      if (parts) batcher.upgradePrototypeMeshes(sp.proto, parts);
    });
  }
}
