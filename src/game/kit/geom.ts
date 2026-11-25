import * as THREE from "three";
import { materialFor, seeded, whiteBasedMaterial } from "./surface";

export function shadeColor(color: THREE.ColorRepresentation, deltaL: number): string {
  const c = new THREE.Color(color);
  c.offsetHSL(0, 0, deltaL);
  return "#" + c.getHexString();
}

const boxGeoCache = new Map<string, THREE.BufferGeometry>();

export function bevelledBox(
  width: number,
  height: number,
  depth: number,
  bevel = 0.025,
  segments = 1
): THREE.BufferGeometry {
  const key = `${width.toFixed(3)}|${height.toFixed(3)}|${depth.toFixed(3)}|${bevel.toFixed(3)}|${segments}`;
  const cached = boxGeoCache.get(key);
  if (cached) return cached.clone();

  const b = Math.max(0.001, Math.min(bevel, width / 2.08, height / 2.08, depth / 2.08));
  const w = Math.max(0.001, width / 2 - b);
  const h = Math.max(0.001, height / 2 - b);
  const shape = new THREE.Shape();
  shape.moveTo(-w, -h);
  shape.lineTo(w, -h);
  shape.lineTo(w, h);
  shape.lineTo(-w, h);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - 2 * b),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: 0,
    bevelSegments: segments,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -(depth / 2 - b));
  geo.computeVertexNormals();
  boxGeoCache.set(key, geo);
  return geo.clone();
}

export function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
  cast = true,
  receive = true
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

export interface InstancePlacement {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  hue?: number;
}

export function scatterInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.MeshStandardMaterial,
  placements: InstancePlacement[],
  cast = true,
  receive = true
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, whiteBasedMaterial(material), placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();
  const base = new THREE.Color(material.color).getHSL({ h: 0, s: 0, l: 0 });

  for (let i = 0; i < placements.length; i++) {
    const pl = placements[i];
    const s = pl.scale ?? 1;
    p.set(pl.position[0], pl.position[1], pl.position[2]);
    const r = pl.rotation ?? [0, 0, 0];
    e.set(r[0], r[1], r[2]);
    q.setFromEuler(e);
    if (Array.isArray(s)) sc.set(s[0], s[1], s[2]);
    else sc.set(s, s, s);
    mesh.setMatrixAt(i, m.compose(p, q, sc));
    const hue = pl.hue ?? 0;
    mesh.setColorAt(
      i,
      tint.setHSL(base.h + hue, base.s, Math.min(1, Math.max(0.05, base.l * (1 + hue * 3.5))))
    );
  }
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

export interface WallOpening {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function wallWithOpenings(
  width: number,
  height: number,
  depth: number,
  openings: WallOpening[],
  material: THREE.Material,
  bevel = 0.02
): THREE.Group {
  const group = new THREE.Group();
  const sorted = [...openings].sort((a, b) => a.x - b.x);
  const solid = (w: number, h: number, x: number, y: number) => {
    if (w <= 0.01 || h <= 0.01) return;
    group.add(part(bevelledBox(w, h, depth, bevel), material, [x, y, 0]));
  };
  let cursor = -width / 2;
  for (const hole of sorted) {
    const left = Math.max(cursor, hole.x - hole.width / 2);
    const right = Math.min(width / 2, hole.x + hole.width / 2);
    const actualW = right - left;
    const actualX = (left + right) / 2;
    const bottom = Math.max(0, hole.y - hole.height / 2);
    const top = Math.min(height, hole.y + hole.height / 2);
    solid(left - cursor, height, (cursor + left) / 2, height / 2);
    if (actualW > 0.01) {
      solid(actualW, bottom, actualX, bottom / 2);
      solid(actualW, height - top, actualX, (height + top) / 2);
    }
    cursor = right;
  }
  solid(width / 2 - cursor, height, (cursor + width / 2) / 2, height / 2);
  return group;
}

export interface InsetWindowOpts {
  width?: number;
  height?: number;
  inset?: number;
  frame?: number;
  bars?: number;
  rows?: number;
  sill?: boolean;
  shutters?: boolean;
  frameColor?: THREE.ColorRepresentation;
  glassColor?: THREE.ColorRepresentation;
  stoneColor?: THREE.ColorRepresentation;
  shutterColor?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation | null;
  emissiveIntensity?: number;
  seed?: number;
}

export function insetWindow(opts: InsetWindowOpts = {}): THREE.Group {
  const {
    width = 0.9,
    height = 1.1,
    inset = 0.12,
    frame = 0.07,
    bars = 1,
    rows = 1,
    sill = true,
    shutters = false,
    frameColor = "#5a422c",
    glassColor = "#24303a",
    stoneColor = "#b5aca0",
    shutterColor = "#3f533b",
    emissive = null,
    emissiveIntensity = 0,
    seed = 1,
  } = opts;

  const group = new THREE.Group();
  const rng = seeded(seed);
  const wood = materialFor(frameColor, { roughness: 0.72, family: "wood", seed: 11 });
  const paneCol = new THREE.Color(glassColor);
  paneCol.offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.05);
  const pane = materialFor("#" + paneCol.getHexString(), {
    roughness: 0.16,
    metalness: 0.12,
    emissive,
    emissiveIntensity,
  });

  // 4 dark reveal jambs lining the recess
  const reveal = materialFor(shadeColor(stoneColor, -0.22), { roughness: 0.94 });
  const jambs: [number, number, number, number][] = [
    [width, 0.025, 0, height / 2],
    [width, 0.025, 0, -height / 2],
    [0.025, height, width / 2, 0],
    [0.025, height, -width / 2, 0],
  ];
  for (const [w, h, x, y] of jambs) {
    group.add(part(bevelledBox(w, h, inset, 0.005), reveal, [x, y, -inset / 2], [0, 0, 0], false, true));
  }

  // recessed glass pane
  group.add(
    part(
      bevelledBox(Math.max(0.1, width - 0.04), Math.max(0.1, height - 0.04), 0.02, 0.005),
      pane,
      [0, 0, -inset + 0.03],
      [0, 0, 0],
      false,
      true
    )
  );

  // mullions / glazing bars proud of glass
  const barZ = -inset + 0.055;
  const innerW = Math.max(0.1, width - 0.04);
  const innerH = Math.max(0.1, height - 0.04);
  for (let i = 1; i <= bars; i++) {
    const x = -innerW / 2 + (i * innerW) / (bars + 1);
    group.add(part(bevelledBox(0.032, innerH, 0.035, 0.007), wood, [x, 0, barZ], [0, 0, 0], false));
  }
  for (let i = 1; i <= rows; i++) {
    const y = -innerH / 2 + (i * innerH) / (rows + 1);
    group.add(part(bevelledBox(innerW, 0.032, 0.035, 0.007), wood, [0, y, barZ], [0, 0, 0], false));
  }

  // outer frame seated flush on wall face (stands 2.5cm proud)
  const cheeks: [number, number, number, number][] = [
    [width + frame, frame, 0, (height + frame) / 2],
    [width + frame, frame, 0, -(height + frame) / 2],
    [frame, height + frame, (width + frame) / 2, 0],
    [frame, height + frame, -(width + frame) / 2, 0],
  ];
  for (const [w, h, x, y] of cheeks) {
    group.add(part(bevelledBox(w, h, 0.065, 0.012), wood, [x, y, -0.01]));
  }

  if (sill) {
    const board = materialFor(stoneColor, { roughness: 0.86, family: "stone", seed: 7 });
    const lip = -height / 2 - frame / 2 - 0.032;
    group.add(part(bevelledBox(width + frame + 0.16, 0.07, 0.18, 0.015), board, [0, lip, 0.055]));
    const drip = materialFor(shadeColor(stoneColor, -0.25), { roughness: 0.95 });
    group.add(part(bevelledBox(width + frame + 0.08, 0.022, 0.03, 0.006), drip, [0, lip - 0.044, 0.12]));
    const lintel = materialFor(shadeColor(stoneColor, 0.06), { roughness: 0.88 });
    group.add(
      part(bevelledBox(width + frame + 0.12, 0.065, 0.12, 0.014), lintel, [
        0,
        height / 2 + frame / 2 + 0.045,
        0.03,
      ])
    );
  }

  if (shutters) {
    const shMat = materialFor(shutterColor, { roughness: 0.78, family: "wood", seed: 19 });
    const shW = width * 0.48;
    const shH = height + frame * 0.4;
    for (const side of [-1, 1]) {
      const sx = side * (width / 2 + frame + shW / 2 + 0.02);
      const shutter = part(bevelledBox(shW, shH, 0.045, 0.01), shMat, [sx, 0, 0.03]);
      group.add(shutter);
      for (let l = -2; l <= 2; l++) {
        group.add(
          part(
            bevelledBox(shW * 0.76, 0.035, 0.02, 0.005),
            materialFor(shadeColor(shutterColor, -0.08), { roughness: 0.82 }),
            [sx, (l * shH) / 6.5, 0.052],
            [0.25, 0, 0],
            false
          )
        );
      }
    }
  }

  return group;
}

export function doorWithStep(opts: {
  width?: number;
  height?: number;
  wallT?: number;
  openAngle?: number;
  frameColor?: THREE.ColorRepresentation;
  doorColor?: THREE.ColorRepresentation;
  stoneColor?: THREE.ColorRepresentation;
} = {}): THREE.Group {
  const {
    width = 1.15,
    height = 2.15,
    wallT = 0.25,
    openAngle = -1.05,
    frameColor = "#4e3924",
    doorColor = "#6a4c30",
    stoneColor = "#9e968a",
  } = opts;
  const g = new THREE.Group();
  const frameMat = materialFor(frameColor, { roughness: 0.75, family: "wood", seed: 3 });
  const doorMat = materialFor(doorColor, { roughness: 0.68, family: "wood", seed: 5 });
  const stoneMat = materialFor(stoneColor, { roughness: 0.88, family: "stone", seed: 9 });
  const brassMat = materialFor("#c8a850", { roughness: 0.3, metalness: 0.85 });

  // step + threshold
  g.add(part(bevelledBox(width + 0.45, 0.12, 0.48, 0.025), stoneMat, [0, 0.06, 0.16]));
  g.add(part(bevelledBox(width + 0.16, 0.06, wallT + 0.12, 0.015), stoneMat, [0, 0.15, 0]));

  // frame posts & header
  for (const sx of [-1, 1]) {
    g.add(part(bevelledBox(0.09, height, wallT + 0.06, 0.015), frameMat, [sx * (width / 2 + 0.03), height / 2, 0]));
  }
  g.add(part(bevelledBox(width + 0.16, 0.1, wallT + 0.08, 0.015), frameMat, [0, height + 0.04, 0]));

  // hinged door leaf
  const pivot = new THREE.Group();
  pivot.position.set(-width / 2, 0.16, -wallT / 2 + 0.05);
  pivot.rotation.y = openAngle;
  const leafH = height - 0.18;
  const leafW = width - 0.04;
  pivot.add(part(bevelledBox(leafW, leafH, 0.06, 0.012), doorMat, [leafW / 2, leafH / 2, 0]));
  // raised panels
  const panelMat = materialFor(shadeColor(doorColor, -0.07), { roughness: 0.72 });
  for (const py of [leafH * 0.28, leafH * 0.72]) {
    pivot.add(part(bevelledBox(leafW * 0.66, leafH * 0.3, 0.08, 0.01), panelMat, [leafW / 2, py, 0]));
  }
  // handles on both sides
  for (const sz of [-1, 1]) {
    pivot.add(part(bevelledBox(0.14, 0.035, 0.04, 0.008), brassMat, [leafW - 0.14, leafH * 0.48, sz * 0.045]));
  }
  g.add(pivot);
  return g;
}

export function gableRoof(opts: {
  width: number;
  depth: number;
  wallH: number;
  pitchDeg?: number;
  eave?: number;
  verge?: number;
  tileColor?: THREE.ColorRepresentation;
  ridgeColor?: THREE.ColorRepresentation;
  wallMat: THREE.Material;
  chimney?: boolean;
  seed?: number;
}): THREE.Group {
  const {
    width,
    depth,
    wallH,
    pitchDeg = 32,
    eave = 0.35,
    verge = 0.25,
    tileColor = "#8a3b2a",
    ridgeColor = "#6c2e20",
    wallMat,
    chimney = true,
    seed = 1,
  } = opts;

  const group = new THREE.Group();
  const rng = seeded(seed);
  const halfD = depth / 2;
  const pitch = (pitchDeg * Math.PI) / 180;
  const run = halfD + eave;
  const ridgeY = wallH + halfD * Math.tan(pitch);
  const eaveY = wallH - eave * Math.tan(pitch);
  const slope = Math.hypot(run, ridgeY - eaveY);
  const spanW = width + 2 * verge;

  // solid roof deck backing so sky never peeks between tiles
  const deckMat = materialFor(shadeColor(tileColor, -0.14), { roughness: 0.9 });
  const deckGeo = bevelledBox(spanW - 0.04, 0.09, slope, 0.015);
  for (const side of [1, -1]) {
    group.add(
      part(
        deckGeo,
        deckMat,
        [0, (ridgeY + eaveY) / 2 - 0.02, (side * run) / 2],
        [side * pitch, 0, 0]
      )
    );
  }

  // instanced overlapping tile courses
  const rows = Math.max(4, Math.min(12, Math.round(slope * 2.1)));
  const strip = bevelledBox(spanW, 0.055, slope / rows + 0.05, 0.012);
  const lap = 0.1;
  const lift = 0.035;
  const placements: InstancePlacement[] = [];
  for (const side of [1, -1]) {
    const ny = Math.cos(pitch) * lift;
    const nz = side * Math.sin(pitch) * lift;
    for (let i = 0; i < rows; i++) {
      const t = (i + 0.5) / rows;
      placements.push({
        position: [0, ridgeY - t * (ridgeY - eaveY) + ny, side * t * run + nz],
        rotation: [side * (pitch - lap), 0, 0],
        hue: (rng() - 0.5) * 0.035,
      });
    }
  }
  const tileMat = materialFor(tileColor, { roughness: 0.78, family: "roof-tile", seed });
  group.add(scatterInstances(strip, tileMat, placements));

  // ridge cap beam
  const ridgeMat = materialFor(ridgeColor, { roughness: 0.84 });
  group.add(part(bevelledBox(spanW + 0.06, 0.14, 0.28, 0.03), ridgeMat, [0, ridgeY + 0.04, 0]));

  // verge fascia beams under the roof overhangs at +/-X
  const fasciaMat = materialFor("#4d3928", { roughness: 0.8 });
  const rafterLen = slope + 0.04;
  const rafterGeo = bevelledBox(0.08, 0.12, rafterLen, 0.015);
  for (const sx of [-1, 1]) {
    for (const side of [-1, 1]) {
      group.add(
        part(
          rafterGeo,
          fasciaMat,
          [sx * (width / 2 + verge * 0.75), (ridgeY + eaveY) / 2 - 0.08, (side * run) / 2],
          [side * pitch, 0, 0]
        )
      );
    }
  }

  // closed gable triangles at +/-X
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-halfD, 0);
  gableShape.lineTo(halfD, 0);
  gableShape.lineTo(0, ridgeY - wallH);
  gableShape.closePath();
  const wallT = 0.25;
  const gableGeo = new THREE.ExtrudeGeometry(gableShape, {
    depth: wallT,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  gableGeo.rotateY(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const gMesh = new THREE.Mesh(gableGeo, wallMat);
    gMesh.position.set(sx * (width / 2 - wallT / 2) - wallT / 2, wallH, 0);
    gMesh.castShadow = true;
    gMesh.receiveShadow = true;
    group.add(gMesh);
  }

  if (chimney) {
    const brick = materialFor("#8b4e3c", { roughness: 0.88, family: "brick", seed: seed + 5 });
    const stone = materialFor("#aba396", { roughness: 0.85, family: "stone", seed: seed + 9 });
    const cx = width * 0.28;
    const cz = -depth * 0.16;
    const top = ridgeY + 0.75;
    const h = top - wallH + 0.3;
    group.add(part(bevelledBox(0.64, h, 0.56, 0.025), brick, [cx, top - h / 2, cz]));
    group.add(part(bevelledBox(0.76, 0.11, 0.68, 0.02), stone, [cx, top + 0.055, cz]));
  }

  return group;
}

export function craftedCrate(size = 1.0, seed = 1): THREE.Group {
  const group = new THREE.Group();
  const rng = seeded(seed);
  const plankCol = "#9c7548";
  const postCol = "#765734";
  const braceCol = "#694d2e";
  const nailCol = "#b8b2a6";

  const post = 0.068 * size;
  const plankT = 0.036 * size;
  const gap = 0.012 * size;
  const count = 4;

  // inner liner so gaps don't show sky
  group.add(
    part(
      bevelledBox(size - 0.08 * size, size - 0.04 * size, size - 0.08 * size, 0.01),
      materialFor("#2f2317", { roughness: 0.98 }),
      [0, size / 2, 0]
    )
  );

  // side planks (instanced)
  const plankH = (size - (count + 1) * gap) / count;
  const sideGeo = bevelledBox(size - 2 * post + 0.015 * size, plankH, plankT, 0.009 * size).clone();
  sideGeo.translate(0, 0, size / 2 - plankT / 2 + 0.004 * size);
  const sidePlacements: InstancePlacement[] = [];
  for (let face = 0; face < 4; face++) {
    for (let i = 0; i < count; i++) {
      sidePlacements.push({
        position: [0, gap + plankH / 2 + i * (plankH + gap), 0],
        rotation: [0, (face * Math.PI) / 2, 0],
        hue: (rng() - 0.5) * 0.05,
      });
    }
  }
  group.add(
    scatterInstances(
      sideGeo,
      materialFor(plankCol, { roughness: 0.82, family: "wood", seed }),
      sidePlacements
    )
  );

  // corner posts
  const postMat = materialFor(postCol, { roughness: 0.72, family: "wood", seed: seed + 3 });
  const off = size / 2 - post / 2 + 0.018 * size;
  const postGeo = bevelledBox(post, size, post, 0.011 * size);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(part(postGeo, postMat, [sx * off, size / 2, sz * off]));
    }
  }

  // diagonal brace on two opposite faces
  const span = size - 2 * post;
  const diagLen = Math.hypot(span, size * 0.86);
  const diagGeo = bevelledBox(diagLen, 0.058 * size, 0.028 * size, 0.008 * size).clone();
  diagGeo.rotateZ(Math.atan2(size * 0.86, span));
  diagGeo.translate(0, size / 2, size / 2 + plankT * 0.55);
  const braceMat = materialFor(braceCol, { roughness: 0.76, family: "wood", seed: seed + 7 });
  for (const face of [0, 2]) {
    group.add(part(diagGeo, braceMat, [0, 0, 0], [0, (face * Math.PI) / 2, 0]));
  }

  // lid planks + battens
  const lidMat = materialFor(plankCol, { roughness: 0.82, family: "wood", seed: seed + 11 });
  const lidW = (size - (count + 1) * gap) / count;
  for (let i = 0; i < count; i++) {
    const lx = -size / 2 + gap + lidW / 2 + i * (lidW + gap);
    group.add(part(bevelledBox(lidW, plankT, size - 0.02 * size, 0.008 * size), lidMat, [lx, size + plankT / 2, 0]));
  }
  for (const sz of [-1, 1]) {
    group.add(
      part(
        bevelledBox(size + 0.02 * size, 0.03 * size, 0.055 * size, 0.008 * size),
        postMat,
        [0, size + plankT + 0.015 * size, sz * (size / 2 - 0.07 * size)]
      )
    );
  }

  // nails
  const nailGeo = new THREE.SphereGeometry(0.013 * size, 6, 4);
  nailGeo.scale(1, 1, 0.5);
  const nails: InstancePlacement[] = [];
  const z0 = size / 2 + plankT * 0.55;
  for (let face = 0; face < 4; face++) {
    const a = (face * Math.PI) / 2;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    for (let i = 0; i < count; i++) {
      const y = gap + plankH / 2 + i * (plankH + gap);
      for (const u of [-(size / 2 - post - 0.012 * size), size / 2 - post - 0.012 * size]) {
        nails.push({
          position: [u * cos + z0 * sin, y, -u * sin + z0 * cos],
          rotation: [0, a, 0],
        });
      }
    }
  }
  group.add(scatterInstances(nailGeo, materialFor(nailCol, { roughness: 0.35, metalness: 0.6 }), nails, false));

  return group;
}

export function craftedBarrel(color: THREE.ColorRepresentation = 0x9b2c22, metalDrum = true): THREE.Group {
  const group = new THREE.Group();
  if (metalDrum) {
    const bodyMat = materialFor(color, { roughness: 0.42, metalness: 0.72, family: "metal", seed: 5 });
    const rimMat = materialFor("#2a2c30", { roughness: 0.38, metalness: 0.85 });
    const capMat = materialFor("#b8b2a6", { roughness: 0.3, metalness: 0.85 });
    const h = 1.05;
    const r = 0.38;
    group.add(part(new THREE.CylinderGeometry(r, r, h, 20), bodyMat, [0, h / 2, 0]));
    for (const ry of [0.05, 0.35, 0.68, h - 0.05]) {
      const hoop = new THREE.TorusGeometry(r + 0.014, 0.018, 6, 20);
      hoop.rotateX(Math.PI / 2);
      group.add(part(hoop, rimMat, [0, ry, 0]));
    }
    group.add(part(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 10), capMat, [0.16, h + 0.01, 0.08]));
    group.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), capMat, [-0.14, h + 0.01, -0.1]));
    return group;
  }

  // coopered oak barrel
  const rng = seeded(17);
  const h = 0.96;
  const r = 0.36;
  const bulge = 0.18;
  const staves = 14;
  const oak = materialFor("#a27446", { roughness: 0.78, family: "wood", seed: 12 });
  const iron = materialFor("#323438", { roughness: 0.4, metalness: 0.75 });
  const prof = (t: number) => r * (1 - bulge * (2 * t - 1) ** 2);
  for (let c = 0; c < 4; c++) {
    const ch = h / 4;
    const y0 = c * ch;
    const y1 = y0 + ch;
    const yc = (y0 + y1) / 2;
    const r0 = prof(y0 / h);
    const r1 = prof(y1 / h);
    const rc = prof(yc / h);
    const w = ((2 * Math.PI * rc) / staves) * 0.94;
    const g = bevelledBox(w, ch * 1.02, 0.05, 0.01).clone();
    g.rotateX(Math.atan2(r1 - r0, ch));
    g.translate(0, yc, rc - 0.025);
    const pls: InstancePlacement[] = [];
    for (let i = 0; i < staves; i++) {
      pls.push({ position: [0, 0, 0], rotation: [0, (i / staves) * Math.PI * 2, 0], hue: (rng() - 0.5) * 0.05 });
    }
    group.add(scatterInstances(g, oak, pls));
  }
  for (const t of [0.06, 0.26, 0.74, 0.94]) {
    const hoop = new THREE.TorusGeometry(prof(t) + 0.008, 0.015, 5, 18);
    hoop.rotateX(Math.PI / 2);
    group.add(part(hoop, iron, [0, t * h, 0]));
  }
  const headMat = materialFor("#b08656", { roughness: 0.85, family: "wood", seed: 13 });
  const hr = prof(0.95) - 0.035;
  group.add(part(new THREE.CylinderGeometry(hr, hr, 0.04, 16), headMat, [0, h - 0.04, 0]));
  return group;
}

export function craftedWell(seed = 1): THREE.Group {
  const group = new THREE.Group();
  const rng = seeded(seed);
  const stone = materialFor("#999286", { roughness: 0.92, family: "stone", seed });
  const coping = materialFor("#aba494", { roughness: 0.84, family: "stone", seed: seed + 1 });
  const postMat = materialFor("#6b5034", { roughness: 0.75, family: "wood", seed: seed + 2 });
  const shingle = materialFor("#7b5847", { roughness: 0.86, family: "roof-tile", seed: seed + 3 });
  const iron = materialFor("#32343a", { roughness: 0.42, metalness: 0.72 });
  const ropeMat = materialFor("#c0a97a", { roughness: 0.95 });
  const waterMat = materialFor("#204d57", { roughness: 0.14, metalness: 0.25 });

  const radius = 0.72;
  const drumH = 0.76;
  const wall = 0.24;
  const blocks = 12;
  const courses = 3;
  const ch = drumH / courses;

  // dark inner shaft + visible water surface
  group.add(
    part(
      new THREE.CylinderGeometry(radius - wall * 0.9, radius - wall * 0.9, drumH - 0.08, 16, 1, true),
      materialFor("#191714", { roughness: 0.98, doubleSide: true }),
      [0, drumH / 2 - 0.02, 0]
    )
  );
  group.add(part(new THREE.CylinderGeometry(radius - wall * 0.92, radius - wall * 0.92, 0.04, 16), waterMat, [0, 0.35, 0], [0, 0, 0], false));

  for (let c = 0; c < courses; c++) {
    const bw = ((2 * Math.PI * radius) / blocks) * 0.9;
    const geo = bevelledBox(bw, ch * 0.94, wall, 0.018).clone();
    geo.translate(0, ch / 2 + c * ch, radius - wall / 2);
    const pls: InstancePlacement[] = [];
    for (let i = 0; i < blocks; i++) {
      pls.push({
        position: [0, 0, 0],
        rotation: [0, ((i + (c % 2) * 0.5) / blocks) * Math.PI * 2, 0],
        hue: (rng() - 0.5) * 0.06,
      });
    }
    group.add(scatterInstances(geo, stone, pls));
  }

  const capGeo = bevelledBox(((2 * Math.PI * radius) / blocks) * 1.03, 0.08, wall + 0.08, 0.015).clone();
  capGeo.translate(0, drumH + 0.04, radius - wall / 2);
  group.add(
    scatterInstances(
      capGeo,
      coping,
      Array.from({ length: blocks }, (_, i) => ({
        position: [0, 0, 0],
        rotation: [0, ((i + 0.25) / blocks) * Math.PI * 2, 0],
        hue: (rng() - 0.5) * 0.04,
      }))
    )
  );

  const rimY = drumH + 0.08;
  const span = 2 * (radius - wall * 0.35);
  const postH = 1.28;
  const pitch = (38 * Math.PI) / 180;
  const run = span / 2 + 0.18;
  const rise = run * Math.tan(pitch);
  const fullPostH = postH + rise - 0.02;
  const eaveY = rimY + postH;
  const ridgeY = eaveY + rise;

  // two timber posts rising to the ridge beam
  for (const sx of [-1, 1]) {
    group.add(part(bevelledBox(0.1, fullPostH, 0.1, 0.015), postMat, [sx * (span / 2), rimY + fullPostH / 2, 0]));
  }

  // shingled roof + rafters + ridge beam
  const slope = Math.hypot(run, rise);
  const rows = 4;
  const strip = bevelledBox(span + 0.34, 0.04, slope / rows + 0.035, 0.008);
  const roofPls: InstancePlacement[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < rows; i++) {
      const t = (i + 0.5) / rows;
      roofPls.push({
        position: [0, ridgeY - t * rise + 0.02, side * t * run],
        rotation: [side * (pitch - 0.12), 0, 0],
        hue: (rng() - 0.5) * 0.05,
      });
    }
  }
  group.add(scatterInstances(strip, shingle, roofPls));
  group.add(part(bevelledBox(span + 0.38, 0.08, 0.12, 0.018), postMat, [0, ridgeY + 0.02, 0]));
  const rafterGeo = bevelledBox(0.065, 0.055, slope + 0.04, 0.01);
  for (const side of [-1, 1]) {
    for (const sx of [-1, 1]) {
      group.add(
        part(rafterGeo, postMat, [sx * (span / 2), (ridgeY + eaveY) / 2 - 0.02, (side * run) / 2], [side * pitch, 0, 0])
      );
    }
  }

  // windlass + rope + bucket
  const axleY = rimY + postH - 0.25;
  const barrel = new THREE.CylinderGeometry(0.075, 0.075, span - 0.08, 10);
  barrel.rotateZ(Math.PI / 2);
  group.add(part(barrel, postMat, [0, axleY, 0]));
  for (const sx of [-1, 1]) {
    const band = new THREE.CylinderGeometry(0.087, 0.087, 0.03, 10);
    band.rotateZ(Math.PI / 2);
    group.add(part(band, iron, [sx * (span / 2 - 0.08), axleY, 0]));
  }
  const coil = new THREE.TorusGeometry(0.09, 0.014, 4, 12);
  coil.rotateY(Math.PI / 2);
  group.add(
    scatterInstances(
      coil,
      ropeMat,
      Array.from({ length: 5 }, (_, i) => ({ position: [-0.09 + i * 0.035, axleY, 0] }))
    )
  );
  const armX = span / 2 + 0.13;
  group.add(part(bevelledBox(0.045, 0.26, 0.045, 0.01), iron, [armX, axleY - 0.1, 0]));
  group.add(part(bevelledBox(0.05, 0.05, 0.26, 0.01), postMat, [armX, axleY - 0.21, 0.12]));

  const drop = axleY - rimY - 0.28;
  group.add(part(new THREE.CylinderGeometry(0.015, 0.015, drop, 6), ropeMat, [0.1, axleY - drop / 2, 0]));
  const bucketMat = materialFor("#8a6842", { roughness: 0.8, doubleSide: true });
  group.add(part(new THREE.CylinderGeometry(0.13, 0.11, 0.26, 12, 1, true), bucketMat, [0.1, axleY - drop - 0.12, 0]));
  const hoop = new THREE.TorusGeometry(0.128, 0.011, 4, 12);
  hoop.rotateX(Math.PI / 2);
  group.add(part(hoop, iron, [0.1, axleY - drop - 0.03, 0]));

  return group;
}

export function craftedStall(seed = 1): THREE.Group {
  const group = new THREE.Group();
  const rng = seeded(seed);
  const width = 2.8;
  const depth = 1.9;
  const height = 2.35;
  const ridgeY = height + 0.34;
  const drop = 0.34;
  const counterY = 0.9;

  const wood = materialFor("#866542", { roughness: 0.78, family: "wood", seed });
  const dark = materialFor("#5a432e", { roughness: 0.86, family: "wood", seed: seed + 1 });
  const cloth = materialFor("#dad2c1", { roughness: 0.94, family: "fabric", seed: seed + 2 });
  const stripe = materialFor("#a4413b", { roughness: 0.92, family: "fabric", seed: seed + 3 });
  const rope = materialFor("#9c8455", { roughness: 0.96 });

  const postGeo = bevelledBox(0.095, height, 0.095, 0.018);
  const lashGeo = new THREE.TorusGeometry(0.07, 0.015, 4, 10);
  const footGeo = bevelledBox(0.22, 0.07, 0.22, 0.018);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (width / 2 - 0.08);
      const pz = sz * (depth / 2 - 0.06);
      group.add(part(postGeo, sz > 0 ? wood : dark, [px, height / 2, pz]));
      group.add(part(footGeo, dark, [px, 0.035, pz]));
      group.add(part(lashGeo, rope, [px, height - 0.14, pz], [Math.PI / 2, 0, 0]));
    }
    group.add(
      part(
        bevelledBox(0.075, ridgeY - height + 0.1, 0.075, 0.015),
        wood,
        [sx * (width / 2 - 0.08), (ridgeY + height - 0.1) / 2, 0]
      )
    );
  }
  for (const sz of [-1, 1]) {
    group.add(part(bevelledBox(width + 0.08, 0.075, 0.075, 0.016), dark, [0, height - 0.05, sz * (depth / 2 - 0.06)]));
  }
  group.add(part(bevelledBox(width + 0.08, 0.085, 0.085, 0.018), dark, [0, ridgeY, 0]));

  // catenary striped canopy + scalloped valance
  const stripes = 8;
  const cW = width + 0.24;
  const run = depth + 0.42;
  const halfRun = run / 2;
  const slope = Math.hypot(halfRun, drop);
  const pitch = Math.atan2(drop, halfRun);
  const sW = cW / stripes;
  const panelGeo = bevelledBox(sW - 0.012, 0.035, slope + 0.08, 0.009);
  for (let i = 0; i < stripes; i++) {
    const cx = -cW / 2 + (i + 0.5) * sW;
    const droop = 0.12 * Math.sin((Math.PI * (i + 0.5)) / stripes);
    for (const side of [-1, 1]) {
      group.add(
        part(panelGeo, i % 2 ? stripe : cloth, [cx, ridgeY - droop - drop / 2, (side * halfRun) / 2], [side * pitch, 0, 0])
      );
    }
  }
  const valanceGeo = bevelledBox(sW * 0.86, 0.25, 0.03, 0.01);
  group.add(
    scatterInstances(
      valanceGeo,
      stripe,
      Array.from({ length: stripes }, (_, i) => {
        const droop = 0.12 * Math.sin((Math.PI * (i + 0.5)) / stripes);
        return {
          position: [-cW / 2 + (i + 0.5) * sW, ridgeY - drop - droop - 0.13, halfRun + 0.03],
          rotation: [0, 0, (rng() - 0.5) * 0.05],
          hue: (rng() - 0.5) * 0.04,
        };
      })
    )
  );

  // 3-plank counter on angled trestle legs + kick board
  for (let i = 0; i < 3; i++) {
    group.add(
      part(
        bevelledBox(width - 0.1, 0.05, 0.19, 0.012),
        materialFor(shadeColor("#866542", 0.03 * i), { roughness: 0.72 }),
        [0, counterY, depth / 2 - 0.12 - i * 0.21]
      )
    );
  }
  const legGeo = bevelledBox(0.07, counterY - 0.04, 0.07, 0.014);
  for (const sx of [-1, 1]) {
    for (const lean of [-1, 1]) {
      group.add(
        part(
          legGeo,
          wood,
          [sx * (width / 2 - 0.32) + lean * 0.12, counterY / 2 - 0.02, depth / 2 - 0.28],
          [lean * 0.15, 0, 0]
        )
      );
    }
  }
  group.add(part(bevelledBox(width - 0.24, 0.34, 0.045, 0.012), dark, [0, counterY - 0.28, depth / 2 - 0.06]));

  // goods on counter (crates + produce)
  const crateGeo = bevelledBox(0.42, 0.28, 0.34, 0.016);
  const crateMat = materialFor("#7c6040", { roughness: 0.85, family: "wood", seed: seed + 5 });
  group.add(
    scatterInstances(crateGeo, crateMat, [
      { position: [-0.85, counterY + 0.16, depth / 2 - 0.28], rotation: [0, 0.15, 0] },
      { position: [-0.32, counterY + 0.16, depth / 2 - 0.32], rotation: [0, -0.1, 0] },
      { position: [-0.6, counterY + 0.44, depth / 2 - 0.3], rotation: [0, 0.2, 0] },
    ])
  );
  const fruitGeo = new THREE.IcosahedronGeometry(0.06, 0);
  const fruitMat = materialFor("#c6682c", { roughness: 0.55 });
  const fruits: InstancePlacement[] = [];
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    const rad = 0.24 * Math.sqrt(rng());
    fruits.push({
      position: [width * 0.28 + Math.cos(a) * rad, counterY + 0.08 + rng() * 0.08, depth / 2 - 0.28 + Math.sin(a) * rad * 0.7],
      rotation: [rng() * 3, rng() * 3, 0],
      scale: 0.8 + rng() * 0.45,
      hue: (rng() - 0.5) * 0.08,
    });
  }
  group.add(scatterInstances(fruitGeo, fruitMat, fruits));

  return group;
}

const rockShapeCache = new Map<number, THREE.BufferGeometry>();

function boulderShape(detail: number, amount: number, seed: number): THREE.BufferGeometry {
  const key = detail * 1000 + Math.round(amount * 100) * 10 + (seed % 9);
  const hit = rockShapeCache.get(key);
  if (hit) return hit.clone();

  const rng = seeded(seed);
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const moves = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`;
    if (!moves.has(k)) moves.set(k, 1 + (rng() - 0.5) * 2 * amount);
    const s = moves.get(k)!;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.82, pos.getZ(i) * s);
  }
  geo.rotateX((rng() - 0.5) * 1.4);
  geo.rotateZ((rng() - 0.5) * 1.4);
  geo.rotateY(rng() * Math.PI * 2);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const sz = bb.getSize(new THREE.Vector3());
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale(1 / sz.x, 1 / sz.y, 1 / sz.z);
  rockShapeCache.set(key, geo);
  return geo.clone();
}

export function craftedRockCluster(scale = 1.0, seed = 1, rockColor: THREE.ColorRepresentation = "#7a7770"): THREE.Group {
  const group = new THREE.Group();
  const rng = seeded(seed);
  const matA = materialFor(rockColor, { roughness: 0.93, flatShading: true });
  const matB = materialFor(shadeColor(rockColor, -0.05), { roughness: 0.84, flatShading: true });
  const shapes = [boulderShape(1, 0.24, seed), boulderShape(0, 0.36, seed + 1)];
  const count = 6;
  const plsA: InstancePlacement[] = [];
  const plsB: InstancePlacement[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + (rng() - 0.5) * 0.5;
    const d = scale * 0.7 * (0.2 + 0.8 * Math.sqrt((i + 0.5) / count));
    const mass = scale * (0.35 + rng() ** 1.5 * 0.65);
    const sc: [number, number, number] = [mass * (0.9 + rng() * 0.5), mass * (0.55 + rng() * 0.5), mass * (0.9 + rng() * 0.5)];
    const pl: InstancePlacement = {
      position: [Math.cos(a) * d, -sc[1] * 0.22, Math.sin(a) * d],
      rotation: [0, rng() * Math.PI * 2, 0],
      scale: sc,
      hue: (rng() - 0.5) * 0.05,
    };
    if (i % 2 === 0) plsA.push(pl);
    else plsB.push(pl);
  }
  if (plsA.length) group.add(scatterInstances(shapes[0], matA, plsA));
  if (plsB.length) group.add(scatterInstances(shapes[1], matB, plsB));

  // pebble ring
  const peb = boulderShape(0, 0.42, seed + 3);
  const grit: InstancePlacement[] = [];
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2;
    const d = scale * (0.55 + rng() * 0.65);
    const sz = scale * (0.07 + rng() * 0.09);
    grit.push({
      position: [Math.cos(a) * d, -sz * 0.28, Math.sin(a) * d],
      rotation: [0, rng() * Math.PI * 2, 0],
      scale: [sz * 1.35, sz, sz * (0.9 + rng() * 0.5)],
      hue: (rng() - 0.5) * 0.06,
    });
  }
  group.add(scatterInstances(peb, materialFor(shadeColor(rockColor, -0.06), { roughness: 0.96, flatShading: true }), grit, false));
  return group;
}

const treeLobeGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.11 * Math.sin(x * 4.7 + y * 3.1) * Math.cos(z * 4.3);
    p.setXYZ(i, x * n, y * n * 0.88, z * n);
  }
  g.computeVertexNormals();
  return g;
})();

export function craftedTreeRound(s = 1.0, seed = 1): THREE.Group {
  const group = new THREE.Group();
  const rng = seeded(seed);
  const bark = materialFor("#6c523b", { roughness: 0.9, family: "wood", seed: 21 });
  const collar = materialFor("#7e6246", { roughness: 0.84, family: "wood", seed: 22 });
  const leaf = materialFor("#446c35", { roughness: 0.86, family: "grass", seed: 23 });
  const rootMat = materialFor("#624a34", { roughness: 0.92, family: "wood", seed: 24 });

  const height = 4.2 * s;
  const radius = 0.23 * s;
  const trunkH = height * 0.54;
  const lean = 0.08 + (rng() - 0.5) * 0.05;

  // root buttresses
  const rootCone = new THREE.ConeGeometry(radius * 0.72, radius * 3.2, 5);
  rootCone.rotateZ(-Math.PI / 2);
  rootCone.scale(1, 0.5, 1);
  rootCone.rotateZ(-0.7);
  rootCone.translate(radius * 0.25, radius * 0.82, 0);
  const rootPls: InstancePlacement[] = [];
  for (let i = 0; i < 5; i++) {
    rootPls.push({
      position: [0, 0, 0],
      rotation: [0, (i / 5) * Math.PI * 2 + rng() * 0.4, 0],
      scale: [0.85 + rng() * 0.4, 1, 0.8 + rng() * 0.5],
      hue: (rng() - 0.5) * 0.04,
    });
  }
  group.add(scatterInstances(rootCone, rootMat, rootPls));

  // segmented leaning trunk + bark collars
  let tx = 0;
  let ty = 0;
  const stops: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const h = trunkH / 4;
    const r0 = radius * (1 - i * 0.16);
    const r1 = radius * (1 - (i + 1) * 0.16);
    const tilt = lean * (0.2 + i * 0.3) + (rng() - 0.5) * 0.04;
    group.add(
      part(
        new THREE.CylinderGeometry(r1, r0, h, 8),
        bark,
        [tx + (Math.sin(tilt) * h) / 2, ty + h / 2, 0],
        [0, 0, -tilt]
      )
    );
    tx += Math.sin(tilt) * h;
    ty += h * Math.cos(tilt);
    stops.push({ x: tx, y: ty, r: r1 });
    if (i < 3) {
      group.add(part(new THREE.CylinderGeometry(r1 * 1.15, r1 * 1.15, 0.05 * s, 8), collar, [tx, ty, 0], [0, 0, -tilt]));
    }
  }

  // branches + canopy lobes
  const tips: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const from = stops[1 + (i % 2)];
    const a = (i / 4) * Math.PI * 2 + rng() * 0.6;
    const reach = (0.55 + rng() * 0.35) * s;
    const rise = (0.5 + rng() * 0.35) * s;
    const len = Math.hypot(reach, rise);
    const brGeo = new THREE.CylinderGeometry(from.r * 0.28, from.r * 0.52, len, 6);
    brGeo.translate(0, len / 2, 0);
    const br = part(brGeo, bark, [from.x, from.y, 0], [0, a, Math.atan2(reach, rise)]);
    group.add(br);
    tips.push([from.x + Math.cos(a) * reach, from.y + rise, -Math.sin(a) * reach]);
  }

  const top = stops[3];
  const crown: [number, number, number] = [top.x, top.y + height * 0.17, 0];
  const cScale = height * 0.21;
  const lobes: InstancePlacement[] = [
    { position: crown, scale: cScale * 1.15, rotation: [0, rng() * 6.28, 0], hue: (rng() - 0.5) * 0.08 },
  ];
  for (const tip of tips) {
    lobes.push({
      position: [tip[0], tip[1] + cScale * 0.5, tip[2]],
      scale: [cScale * (0.75 + rng() * 0.4), cScale * (0.65 + rng() * 0.35), cScale * (0.75 + rng() * 0.4)],
      rotation: [0, rng() * 6.28, 0],
      hue: (rng() - 0.5) * 0.09,
    });
  }
  lobes.push({
    position: [crown[0] + cScale * 0.48, crown[1] - cScale * 0.5, cScale * 0.38],
    scale: cScale * 0.82,
    rotation: [0, rng() * 6.28, 0],
    hue: (rng() - 0.5) * 0.08,
  });
  group.add(scatterInstances(treeLobeGeo, leaf, lobes));

  return group;
}

const boughGeo = (() => {
  const g = new THREE.ConeGeometry(0.3, 1, 6);
  g.rotateZ(-Math.PI / 2);
  g.scale(1, 0.4, 1);
  g.translate(0.5, 0, 0);
  return g;
})();

const skirtGeo = (() => {
  const g = new THREE.ConeGeometry(1, 1, 9);
  g.translate(0, 0.5, 0);
  return g;
})();

export function craftedTreeConifer(s = 1.0, seed = 1): THREE.Group {
  const group = new THREE.Group();
  const rng = seeded(seed);
  const bark = materialFor("#654e3c", { roughness: 0.9, family: "wood", seed: 25 });
  const needle = materialFor("#3b6442", { roughness: 0.86, family: "grass", seed: 26 });
  const h = 4.6 * s;
  const r = 0.17 * s;

  let tx = 0;
  let ty = 0;
  const spine: [number, number][] = [[0, 0]];
  const lean = 0.05;
  for (let i = 0; i < 4; i++) {
    const seg = h / 4;
    const tilt = lean * (0.2 + i * 0.3);
    group.add(
      part(
        new THREE.CylinderGeometry(r * (1 - (i + 1) * 0.2), r * (1 - i * 0.2), seg, 7),
        bark,
        [tx + (Math.sin(tilt) * seg) / 2, ty + seg / 2, 0],
        [0, 0, -tilt]
      )
    );
    tx += Math.sin(tilt) * seg;
    ty += seg * Math.cos(tilt);
    spine.push([tx, ty]);
  }
  const spineAt = (t: number): [number, number] => {
    const u = Math.min(0.999, Math.max(0, t)) * 4;
    const i = Math.floor(u);
    const f = u - i;
    return [spine[i][0] + (spine[i + 1][0] - spine[i][0]) * f, spine[i][1] + (spine[i + 1][1] - spine[i][1]) * f];
  };

  const whorls = 7;
  const perWhorl = 8;
  const skirtR = h * 0.27;
  const boughs: InstancePlacement[] = [];
  const skirts: InstancePlacement[] = [];
  for (let i = 0; i < whorls; i++) {
    const t = 0.18 + (i / (whorls - 1)) * 0.8;
    const [sx, sy] = spineAt(t);
    const shrink = (1 - i / (whorls + 1.5)) ** 1.45;
    const reach = skirtR * shrink;
    const turn = rng() * Math.PI * 2;
    skirts.push({
      position: [sx, sy - reach * 0.16, 0],
      rotation: [0, turn, 0],
      scale: [reach * 0.85, reach * 0.95, reach * 0.85],
      hue: (rng() - 0.5) * 0.08,
    });
    for (let b = 0; b < perWhorl; b++) {
      const a = turn + (b / perWhorl) * Math.PI * 2 + (rng() - 0.5) * 0.2;
      const arm = reach * (1.0 + rng() * 0.28);
      boughs.push({
        position: [sx, sy, 0],
        rotation: [0, a, -(0.34 + rng() * 0.24)],
        scale: [arm, arm * 0.92, arm * (0.75 + rng() * 0.35)],
        hue: (rng() - 0.5) * 0.09,
      });
    }
  }
  group.add(scatterInstances(skirtGeo, needle, skirts));
  group.add(scatterInstances(boughGeo, needle, boughs));
  const tip = spineAt(1);
  group.add(part(new THREE.ConeGeometry(skirtR * 0.15, h * 0.18, 7), needle, [tip[0], tip[1] + h * 0.08, 0]));
  return group;
}
