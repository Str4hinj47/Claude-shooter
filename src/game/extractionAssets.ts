/* ------------------------------------------------------------------ */
/*  EXTRACTION ASSETS — Impeccable 3D getaway vehicles, boat & helis  */
/* ------------------------------------------------------------------ */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createLightPoolMaterial, createVolumetricBeamMaterial } from "./shaders";

export interface AnimatedAsset {
  group: THREE.Group;
  colliders: THREE.Mesh[];
  update: (dt: number) => void;
}

function makePlateTex(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8eaed";
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = "#1e293b";
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 56);
  g.fillStyle = "#111827";
  g.font = "bold 30px monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wheelMesh(radius: number, width: number, rimColor = 0x94a3b8): THREE.Group {
  const w = new THREE.Group();
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.85, metalness: 0.08 });
  const rimMat = new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.25, metalness: 0.88 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x3b424c, roughness: 0.4, metalness: 0.75 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35, metalness: 0.4 });

  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 24), tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  w.add(tire);

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.012, 20), rimMat);
  rim.rotation.z = Math.PI / 2;
  w.add(rim);

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width + 0.02, 16), discMat);
  disc.rotation.z = Math.PI / 2;
  w.add(disc);

  // 5 spoke bars
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(width + 0.028, radius * 0.56, 0.035), rimMat);
    spoke.rotation.x = a;
    w.add(spoke);
  }

  const caliper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.4, radius * 0.28, radius * 0.22), caliperMat);
  caliper.position.set(0, radius * 0.22, -radius * 0.22);
  w.add(caliper);
  return w;
}

export function createGetawayCar(opts: {
  variant: "sedan" | "suv" | "coupe";
  x: number;
  z: number;
  ry: number;
  headlights?: boolean;
}): AnimatedAsset {
  const grp = new THREE.Group();
  grp.position.set(opts.x, 0, opts.z);
  grp.rotation.y = opts.ry;

  const isSuv = opts.variant === "suv";
  const isCoupe = opts.variant === "coupe";

  const paintColor = isSuv ? 0x252b34 : isCoupe ? 0x1e2533 : 0x222733;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: paintColor,
    roughness: isSuv ? 0.42 : 0.16,
    metalness: isSuv ? 0.48 : 0.82,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.6, metalness: 0.35 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.2, metalness: 0.92 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0b1320,
    roughness: 0.06,
    metalness: 0.35,
    transparent: true,
    opacity: 0.88,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xf0f9ff,
    emissive: opts.headlights ? 0xdbeafe : 0x93c5fd,
    emissiveIntensity: opts.headlights ? 4.2 : 1.6,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff2222,
    emissive: 0xef4444,
    emissiveIntensity: 2.6,
  });
  const amberMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 2.2,
  });

  const bodyGrp = new THREE.Group();
  grp.add(bodyGrp);

  const length = isSuv ? 4.75 : isCoupe ? 4.55 : 4.65;
  const width = isSuv ? 2.04 : 1.94;
  const lowerH = isSuv ? 0.72 : 0.56;
  const wheelR = isSuv ? 0.39 : 0.34;
  const groundClear = wheelR * 0.68;

  // Lower chassis + sculpted wheel-arch sills
  const chassis = new THREE.Mesh(
    new RoundedBoxGeometry(width, lowerH, length, 4, 0.09),
    bodyMat,
  );
  chassis.position.y = groundClear + lowerH / 2;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  bodyGrp.add(chassis);

  // Side skirts & front splitter lip
  const skirt = new THREE.Mesh(new RoundedBoxGeometry(width + 0.06, 0.1, length - 0.12, 2, 0.03), trimMat);
  skirt.position.y = groundClear + 0.04;
  bodyGrp.add(skirt);

  // Cabin greenhouse
  const cabinLen = isSuv ? 2.95 : isCoupe ? 2.15 : 2.35;
  const cabinH = isSuv ? 0.66 : 0.52;
  const cabinZ = isSuv ? -0.35 : -0.18;
  const cabin = new THREE.Mesh(
    new RoundedBoxGeometry(width - 0.24, cabinH, cabinLen, 4, 0.11),
    bodyMat,
  );
  cabin.position.set(0, groundClear + lowerH + cabinH / 2 - 0.05, cabinZ);
  cabin.castShadow = true;
  bodyGrp.add(cabin);

  // Tinted panoramic windshield + rear glass + side windows
  const ws = new THREE.Mesh(new RoundedBoxGeometry(width - 0.34, cabinH * 0.82, 0.06, 2, 0.02), glassMat);
  ws.position.set(0, groundClear + lowerH + cabinH * 0.44, cabinZ + cabinLen / 2 - 0.02);
  ws.rotation.x = isSuv ? -0.45 : -0.68;
  bodyGrp.add(ws);

  const rw = new THREE.Mesh(new RoundedBoxGeometry(width - 0.36, cabinH * 0.8, 0.06, 2, 0.02), glassMat);
  rw.position.set(0, groundClear + lowerH + cabinH * 0.44, cabinZ - cabinLen / 2 + 0.02);
  rw.rotation.x = isSuv ? 0.3 : 0.72;
  bodyGrp.add(rw);

  for (const sx of [-1, 1]) {
    const sw = new THREE.Mesh(new RoundedBoxGeometry(0.05, cabinH * 0.66, cabinLen * 0.78, 2, 0.015), glassMat);
    sw.position.set(sx * ((width - 0.24) / 2 - 0.01), groundClear + lowerH + cabinH * 0.46, cabinZ);
    bodyGrp.add(sw);

    // Side mirrors
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.1, 0.12, 2, 0.03), bodyMat);
    mirror.position.set(sx * (width / 2 + 0.05), groundClear + lowerH + 0.06, cabinZ + cabinLen * 0.32);
    bodyGrp.add(mirror);

    // Chrome door handles
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.16), chromeMat);
    handle.position.set(sx * (width / 2 + 0.005), groundClear + lowerH - 0.08, cabinZ + 0.12);
    bodyGrp.add(handle);
  }

  // Front grille + headlights + license plate
  const grille = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.26, 0.06, 2, 0.02), trimMat);
  grille.position.set(0, groundClear + lowerH * 0.46, length / 2 + 0.01);
  bodyGrp.add(grille);

  const grilleFrame = new THREE.Mesh(new RoundedBoxGeometry(1.02, 0.3, 0.03, 2, 0.02), chromeMat);
  grilleFrame.position.set(0, groundClear + lowerH * 0.46, length / 2 - 0.01);
  bodyGrp.add(grilleFrame);

  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.11, 0.06, 2, 0.02), headMat);
    hl.position.set(sx * (width / 2 - 0.26), groundClear + lowerH * 0.64, length / 2 - 0.01);
    bodyGrp.add(hl);

    // Dual chrome exhaust tips
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), chromeMat);
    ex.rotation.x = Math.PI / 2;
    ex.position.set(sx * 0.56, groundClear + 0.07, -length / 2 - 0.02);
    bodyGrp.add(ex);
  }

  // Rear full-width LED tail light bar + trunk spoiler + rear plate
  const tailBar = new THREE.Mesh(new RoundedBoxGeometry(width - 0.22, 0.075, 0.05, 2, 0.02), tailMat);
  tailBar.position.set(0, groundClear + lowerH * 0.68, -length / 2 - 0.01);
  bodyGrp.add(tailBar);

  if (isCoupe || opts.variant === "sedan") {
    const spoiler = new THREE.Mesh(new RoundedBoxGeometry(width - 0.24, 0.05, 0.18, 2, 0.02), trimMat);
    spoiler.position.set(0, groundClear + lowerH + 0.04, -length / 2 + 0.14);
    bodyGrp.add(spoiler);
  }

  const plateMat = new THREE.MeshStandardMaterial({ map: makePlateTex("V0SS-07"), roughness: 0.4 });
  const rPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.11), plateMat);
  rPlate.position.set(0, groundClear + lowerH * 0.38, -length / 2 - 0.015);
  rPlate.rotation.y = Math.PI;
  bodyGrp.add(rPlate);

  if (isSuv) {
    // Roof tactical rack + rear-mounted spare tire + bull bar
    for (const sx of [-0.62, 0.62]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 2.3), trimMat);
      rail.position.set(sx, groundClear + lowerH + cabinH, -0.35);
      bodyGrp.add(rail);
    }
    const bull = new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.34, 0.1, 2, 0.03), trimMat);
    bull.position.set(0, groundClear + 0.32, length / 2 + 0.07);
    bodyGrp.add(bull);
    const spare = wheelMesh(wheelR * 0.9, 0.24, 0x475569);
    spare.rotation.y = Math.PI / 2;
    spare.position.set(0, groundClear + lowerH * 0.55, -length / 2 - 0.14);
    bodyGrp.add(spare);
  }

  // Headlight volumetric beams + ground pools at night / low-light
  if (opts.headlights) {
    const beamMat = createVolumetricBeamMaterial(0xdbeafe, 0.22);
    const poolMat = createLightPoolMaterial(0xdbeafe, 0.42);
    for (const sx of [-0.68, 0.68]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1.15, 7.2, 20, 1, true), beamMat);
      beam.rotation.x = -Math.PI / 2 + 0.08;
      beam.position.set(sx, groundClear + lowerH * 0.56 - 0.15, length / 2 + 3.6);
      grp.add(beam);

      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 7.6), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(sx, 0.04, length / 2 + 4.0);
      grp.add(pool);
    }
  }

  // Hazard corner markers (subtle blink)
  const hazards: THREE.MeshStandardMaterial[] = [];
  for (const sx of [-1, 1]) {
    const hz = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.05), amberMat.clone());
    hz.position.set(sx * (width / 2 - 0.16), groundClear + lowerH * 0.52, -length / 2 - 0.012);
    bodyGrp.add(hz);
    hazards.push(hz.material as THREE.MeshStandardMaterial);
  }

  // 4 wheels
  const wx = width / 2 - 0.06;
  const wz = length * 0.32;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = wheelMesh(wheelR, 0.26, isCoupe ? 0xcbd5e1 : 0x64748b);
      w.position.set(sx * wx, wheelR, sz * wz);
      if (sx < 0) w.rotation.y = Math.PI;
      grp.add(w);
    }
  }

  // Collision box
  const col = new THREE.Mesh(new THREE.BoxGeometry(width + 0.15, lowerH + cabinH + 0.2, length + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
  col.position.y = (lowerH + cabinH + 0.2) / 2;
  col.userData.kind = "metal";
  grp.add(col);

  let t = Math.random() * 6;
  return {
    group: grp,
    colliders: [col],
    update: (dt: number) => {
      t += dt;
      // subtle engine idle vibration + alternating amber hazard blink
      bodyGrp.position.y = Math.sin(t * 28) * 0.0025;
      const blink = Math.sin(t * 4.2) > 0.15 ? 2.8 : 0.2;
      for (const h of hazards) h.emissiveIntensity = blink;
    },
  };
}

export function createEscapeBoat(x: number, y: number, z: number, ry: number): AnimatedAsset {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.y = ry;

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1e2634, roughness: 0.24, metalness: 0.72 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.35 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a643e, roughness: 0.68, metalness: 0.08 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.42, metalness: 0.62 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.16, metalness: 0.92 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f1f30,
    roughness: 0.06,
    metalness: 0.3,
    transparent: true,
    opacity: 0.85,
  });

  const boatBody = new THREE.Group();
  grp.add(boatBody);

  // Main sleek offshore hull + crisp silver-white waterline sheer stripe
  const mainHull = new THREE.Mesh(new RoundedBoxGeometry(2.65, 0.95, 6.2, 4, 0.18), hullMat);
  mainHull.position.y = 0.42;
  mainHull.castShadow = true;
  mainHull.receiveShadow = true;
  boatBody.add(mainHull);

  const sheerStripe = new THREE.Mesh(new RoundedBoxGeometry(2.7, 0.12, 6.24, 2, 0.03), stripeMat);
  sheerStripe.position.y = 0.66;
  boatBody.add(sheerStripe);

  // Warm LED courtesy cockpit glow strips along inside gunwales
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 2.0 });
  for (const sx of [-1.04, 1.04]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 3.8), ledMat);
    strip.position.set(sx, 0.95, -0.35);
    boatBody.add(strip);
  }

  // Tapered bow nose cone
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.36, 2.7, 4), hullMat);
  bow.rotation.y = Math.PI / 4;
  bow.rotation.x = Math.PI / 2;
  bow.scale.set(1.25, 1.0, 0.42);
  bow.position.set(0, 0.48, 4.1);
  bow.castShadow = true;
  boatBody.add(bow);

  // Teak cockpit deck inset
  const deck = new THREE.Mesh(new RoundedBoxGeometry(2.15, 0.08, 5.2, 2, 0.03), deckMat);
  deck.position.set(0, 0.89, -0.1);
  boatBody.add(deck);

  // Gunwale chrome rub-rail
  const rail = new THREE.Mesh(new RoundedBoxGeometry(2.74, 0.07, 6.3, 2, 0.02), chromeMat);
  rail.position.set(0, 0.86, 0);
  boatBody.add(rail);

  // Tinted wrap-around sport windscreen
  const wind = new THREE.Mesh(new RoundedBoxGeometry(2.12, 0.48, 0.07, 2, 0.02), glassMat);
  wind.position.set(0, 1.15, 1.35);
  wind.rotation.x = -0.52;
  boatBody.add(wind);

  // Helm console + glowing cyan sonar screen + captain seats
  const helm = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.56, 0.58, 2, 0.06), trimMat);
  helm.position.set(0.32, 1.16, 0.85);
  boatBody.add(helm);

  const navScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.38, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x22d3ee, emissiveIntensity: 2.0 }),
  );
  navScreen.position.set(0.32, 1.24, 0.555);
  navScreen.rotation.y = Math.PI;
  navScreen.rotation.x = 0.25;
  boatBody.add(navScreen);

  const seatMat = new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.6 });
  for (const sx of [-0.45, 0.45]) {
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.62, 0.52, 2, 0.06), seatMat);
    seat.position.set(sx, 1.18, 0.02);
    boatBody.add(seat);
  }
  const bench = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.44, 0.6, 2, 0.06), seatMat);
  bench.position.set(0, 1.1, -1.75);
  boatBody.add(bench);

  // Radar arch + navigation lights (port red, starboard green, masthead white)
  for (const sx of [-0.95, 0.95]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.3, 10), chromeMat);
    pillar.position.set(sx, 1.5, -1.15);
    pillar.rotation.x = 0.16;
    boatBody.add(pillar);
  }
  const archBar = new THREE.Mesh(new RoundedBoxGeometry(2.05, 0.08, 0.24, 2, 0.03), chromeMat);
  archBar.position.set(0, 2.12, -1.25);
  boatBody.add(archBar);

  const portLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 3.4 }),
  );
  portLight.position.set(-1.0, 2.16, -1.25);
  boatBody.add(portLight);

  const stbdLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x34d399, emissiveIntensity: 3.4 }),
  );
  stbdLight.position.set(1.0, 2.16, -1.25);
  boatBody.add(stbdLight);

  const mastLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfde68a, emissiveIntensity: 3.6 }),
  );
  mastLight.position.set(0, 2.34, -1.25);
  boatBody.add(mastLight);

  // Twin outboard motors at transom
  for (const sx of [-0.46, 0.46]) {
    const cowl = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.72, 0.56, 3, 0.08), trimMat);
    cowl.position.set(sx, 0.92, -3.28);
    boatBody.add(cowl);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.65, 0.24), hullMat);
    leg.position.set(sx, 0.35, -3.28);
    boatBody.add(leg);
  }

  // Gentle water wake ring beneath boat
  const wake = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.6, 36),
    new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.y = 0.04;
  grp.add(wake);

  let t = Math.random() * 6;
  return {
    group: grp,
    colliders: [],
    update: (dt: number) => {
      t += dt;
      boatBody.position.y = Math.sin(t * 1.9) * 0.07;
      boatBody.rotation.z = Math.sin(t * 1.4) * 0.028;
      boatBody.rotation.x = Math.cos(t * 1.6) * 0.018;
      (mastLight.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 5.0) > 0.4 ? 4.2 : 1.0;
    },
  };
}

export function createExtractionHeli(x: number, y: number, z: number, ry: number, accentHex = 0x34d399): AnimatedAsset {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.y = ry;

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x232934, roughness: 0.36, metalness: 0.66 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x384152, roughness: 0.44, metalness: 0.62 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xb0bccb, roughness: 0.28, metalness: 0.85 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0e1d30,
    roughness: 0.06,
    metalness: 0.35,
    transparent: true,
    opacity: 0.82,
  });

  // Landing skids + cross-struts resting flush on y = 0
  for (const sx of [-1.18, 1.18]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 5.4, 12), metalMat);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(sx, 0.065, 0.15);
    skid.castShadow = true;
    grp.add(skid);

    // upturned front skid tip
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.55, 10), metalMat);
    tip.rotation.x = Math.PI / 3;
    tip.position.set(sx, 0.22, 3.02);
    grp.add(tip);

    for (const sz of [-1.25, 1.35]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.78, 10), metalMat);
      strut.position.set(sx * 0.84, 0.42, sz);
      strut.rotation.z = sx > 0 ? 0.38 : -0.38;
      grp.add(strut);
    }
  }

  // Main fuselage cabin + cockpit nose
  const fuselage = new THREE.Mesh(new RoundedBoxGeometry(2.15, 1.72, 4.6, 4, 0.24), bodyMat);
  fuselage.position.set(0, 1.54, 0.35);
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  grp.add(fuselage);

  const nose = new THREE.Mesh(new RoundedBoxGeometry(1.78, 1.24, 1.65, 4, 0.28), bodyMat);
  nose.position.set(0, 1.36, 3.05);
  nose.rotation.x = 0.18;
  nose.castShadow = true;
  grp.add(nose);

  // Cockpit canopy glass + glowing avionics dash
  const canopy = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.88, 1.45, 3, 0.16), glassMat);
  canopy.position.set(0, 1.78, 2.68);
  canopy.rotation.x = 0.42;
  grp.add(canopy);

  const avionics = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.18, 0.25),
    new THREE.MeshStandardMaterial({ color: accentHex, emissive: accentHex, emissiveIntensity: 1.8 }),
  );
  avionics.position.set(0, 1.5, 2.75);
  grp.add(avionics);

  // Open side cabin bay glow (warm welcoming cabin interior bar)
  const cabinBay = new THREE.Mesh(
    new THREE.BoxGeometry(2.18, 0.92, 1.65),
    new THREE.MeshStandardMaterial({ color: 0x0f131a, emissive: 0xffb84d, emissiveIntensity: 0.35, roughness: 0.8 }),
  );
  cabinBay.position.set(0, 1.44, 0.25);
  grp.add(cabinBay);

  // Twin upper turbine cowlings + exhaust ports
  for (const sx of [-0.46, 0.46]) {
    const eng = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.62, 2.4, 3, 0.14), trimMat);
    eng.position.set(sx, 2.58, 0.05);
    eng.castShadow = true;
    grp.add(eng);

    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.45, 14), metalMat);
    ex.rotation.x = Math.PI / 2 - 0.12;
    ex.position.set(sx, 2.56, -1.24);
    grp.add(ex);
  }

  // Tapered tail boom + horizontal stabilizers + swept vertical fin
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.5, 5.2, 14), bodyMat);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 1.84, -4.45);
  boom.castShadow = true;
  grp.add(boom);

  const hStab = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.09, 0.56, 2, 0.03), trimMat);
  hStab.position.set(0, 1.86, -6.25);
  grp.add(hStab);

  const vFin = new THREE.Mesh(new RoundedBoxGeometry(0.18, 1.55, 0.88, 2, 0.05), bodyMat);
  vFin.position.set(0, 2.45, -6.95);
  vFin.rotation.x = -0.34;
  vFin.castShadow = true;
  grp.add(vFin);

  // FLIR nose camera turret
  const flir = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), trimMat);
  flir.position.set(0, 0.86, 3.55);
  grp.add(flir);
  const flirLens = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.8 }),
  );
  flirLens.position.set(0, 0.84, 3.76);
  grp.add(flirLens);

  // Navigation & anti-collision strobes
  const tailBeacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff2020, emissiveIntensity: 4.0 }),
  );
  tailBeacon.position.set(0, 3.24, -7.2);
  grp.add(tailBeacon);

  // Main Rotor Hub + 4 long swept composite blades
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 3.04, 0.35);
  grp.add(mainRotor);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.45, 14), metalMat);
  mast.position.y = -0.15;
  mainRotor.add(mast);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 16), trimMat);
  mainRotor.add(hub);

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.42, metalness: 0.55 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xb45309, emissiveIntensity: 0.8 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 4) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.038, 0.28), bladeMat);
    blade.position.x = 2.65;
    blade.castShadow = true;
    arm.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.285), tipMat);
    tip.position.x = 5.1;
    arm.add(tip);
    mainRotor.add(arm);
  }

  // Tail Rotor (4-blade cross rotor)
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.16, 2.55, -7.05);
  grp.add(tailRotor);
  const tHub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 10), metalMat);
  tHub.rotation.z = Math.PI / 2;
  tailRotor.add(tHub);
  for (let i = 0; i < 4; i++) {
    const tBlade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.35, 0.12), bladeMat);
    tBlade.rotation.x = (i / 4) * Math.PI * 2;
    tailRotor.add(tBlade);
  }

  // Belly landing spotlight beam + soft radial ground pool + rotor blur halo
  const spotBeam = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 4.4, 24, 1, true),
    createVolumetricBeamMaterial(0xe0f2fe, 0.16),
  );
  spotBeam.position.set(0, 0.55, 3.8);
  spotBeam.rotation.x = -0.38;
  grp.add(spotBeam);

  const spotPool = new THREE.Mesh(
    new THREE.PlaneGeometry(5.5, 5.5),
    createLightPoolMaterial(0xe0f2fe, 0.38),
  );
  spotPool.rotation.x = -Math.PI / 2;
  spotPool.position.set(0, 0.06, 4.6);
  grp.add(spotPool);

  const rotorBlur = new THREE.Mesh(
    new THREE.RingGeometry(1.4, 5.25, 48),
    new THREE.MeshBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false }),
  );
  rotorBlur.rotation.x = -Math.PI / 2;
  rotorBlur.position.set(0, 3.04, 0.35);
  grp.add(rotorBlur);

  // Collider box around main fuselage (keeps player from walking through cabin)
  const col = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.8, 5.4), new THREE.MeshBasicMaterial({ visible: false }));
  col.position.set(0, 1.4, 0.7);
  col.userData.kind = "metal";
  grp.add(col);

  let t = Math.random() * 6;
  return {
    group: grp,
    colliders: [col],
    update: (dt: number) => {
      t += dt;
      mainRotor.rotation.y += dt * 15.5;
      tailRotor.rotation.x += dt * 26.0;
      (tailBeacon.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 6.0) > 0.3 ? 4.8 : 0.35;
    },
  };
}
