/* ------------------------------------------------------------------ */
/*  INTERACTABLES — Impeccable 3D heist & espionage props             */
/* ------------------------------------------------------------------ */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { InteractDef } from "./story";

export interface InteractableInstance {
  def: InteractDef;
  group: THREE.Group;
  pos: THREE.Vector3;
  done: boolean;
  update: (dt: number) => void;
  setProgress: (p: number) => void;
  setDone: () => void;
}

function makeTerminalMainTex(
  header: string,
  status: string,
  bg: string,
  fg: string,
  progress = -1,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 320;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 320);

  // Outer bezel frame + top title bar
  g.strokeStyle = fg;
  g.lineWidth = 4;
  g.strokeRect(10, 10, 492, 300);
  g.fillStyle = fg;
  g.fillRect(10, 10, 492, 38);

  g.fillStyle = "#041016";
  g.font = "bold 20px monospace";
  g.fillText(header, 22, 36);

  g.fillStyle = fg;
  g.font = "bold 22px monospace";
  g.fillText(status, 24, 84);

  // File tree lines
  const files = [
    "/vault/offshore_ledgers.db   [ENCRYPTED]",
    "/vault/client_records.enc    [LOCKED]",
    "/sys/audit_telemetry.bin     [ACTIVE]",
    "/net/relay_keys.pem          [RSA-4096]",
  ];
  g.font = "15px monospace";
  files.forEach((f, idx) => {
    g.fillStyle = progress >= 1 ? "rgba(16,185,129,0.55)" : "rgba(226,232,240,0.78)";
    g.fillText(progress >= 1 ? f.replace(/\[.*?\]/, "[ZEROED]") : f, 24, 124 + idx * 28);
  });

  // Live wipe progress bar
  g.strokeStyle = fg;
  g.lineWidth = 2;
  g.strokeRect(24, 248, 464, 28);
  if (progress >= 0) {
    g.fillStyle = fg;
    g.fillRect(28, 252, Math.max(4, 456 * Math.min(1, progress)), 20);
  }
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = "bold 14px monospace";
  g.fillText(progress >= 1 ? "WIPE COMPLETE — 0 BYTES LEFT" : progress > 0 ? `SCRUBBING SECTORS: ${Math.round(progress * 100)}%` : "AWAITING [F] COMMAND", 24, 296);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSideTelemetryTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 384;
  const g = c.getContext("2d")!;
  g.fillStyle = "#06131c";
  g.fillRect(0, 0, 256, 384);
  g.strokeStyle = "#0ea5e9";
  g.lineWidth = 3;
  g.strokeRect(8, 8, 240, 368);
  g.fillStyle = "#38bdf8";
  g.font = "bold 16px monospace";
  g.fillText("FIREWALL TRACE", 20, 38);
  // Waveform bars
  for (let i = 0; i < 16; i++) {
    const w = 40 + ((i * 53) % 160);
    g.fillStyle = i % 4 === 0 ? "rgba(245,158,11,0.7)" : "rgba(34,211,238,0.45)";
    g.fillRect(20, 58 + i * 18, w, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeDossierTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d9c297";
  g.fillRect(0, 0, 256, 320);
  g.strokeStyle = "#b89f72";
  g.lineWidth = 4;
  g.strokeRect(8, 8, 240, 304);

  // Redacted black ink bars
  g.fillStyle = "#1c1917";
  for (let i = 0; i < 6; i++) {
    g.fillRect(24, 130 + i * 24, 120 + ((i * 37) % 80), 10);
  }

  // Crimson CLASSIFIED stamp
  g.save();
  g.translate(128, 76);
  g.rotate(-0.14);
  g.strokeStyle = "#b91c1c";
  g.lineWidth = 5;
  g.strokeRect(-86, -24, 172, 48);
  g.fillStyle = "#b91c1c";
  g.font = "bold 24px monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("CLASSIFIED", 0, 1);
  g.restore();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makePlaqueTex(title: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#261c0b";
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = "#d4af37";
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 56);
  g.fillStyle = "#f3d87a";
  g.font = "bold 17px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(title.toUpperCase(), 128, 33, 222);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBullionStampTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f5c542";
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = "#92610c";
  g.lineWidth = 5;
  g.strokeRect(10, 10, 236, 108);
  g.fillStyle = "#6b4306";
  g.font = "bold 26px serif";
  g.textAlign = "center";
  g.fillText("999.9 FINE GOLD", 128, 58);
  g.font = "bold 18px monospace";
  g.fillText("1000g  •  RESERVE", 128, 92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function createBrilliantDiamondGeometry(radius = 0.19, height = 0.27): THREE.BufferGeometry {
  // Lathe profile: pavilion tip -> girdle -> chamfered crown -> flat table
  const pts = [
    new THREE.Vector2(0.001, -height * 0.62),
    new THREE.Vector2(radius, 0.0),
    new THREE.Vector2(radius * 0.99, height * 0.08),
    new THREE.Vector2(radius * 0.62, height * 0.38),
    new THREE.Vector2(0.001, height * 0.38),
  ];
  const geo = new THREE.LatheGeometry(pts, 10);
  geo.computeVertexNormals();
  return geo;
}

function createBullionIngotGeometry(w = 0.16, h = 0.08, l = 0.32): THREE.BufferGeometry {
  // Trapezoidal gold ingot extruded along Z
  const hw = w / 2;
  const tw = w * 0.38;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(tw, h);
  shape.lineTo(-tw, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: l,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -l / 2);
  geo.computeVertexNormals();
  return geo;
}

export function createInteractableProp(def: InteractDef): InteractableInstance {
  const grp = new THREE.Group();
  const baseY = def.y ?? 0;
  grp.position.set(def.x, baseY, def.z);
  if (def.ry) grp.rotation.y = def.ry;

  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x1c2028, roughness: 0.42, metalness: 0.78 });
  const brushedAlum = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.28, metalness: 0.88 });
  const walnutMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.58, metalness: 0.08 });
  const accentColor =
    def.kind === "diamond" ? 0x38bdf8 : def.kind === "relic" ? 0xfbbf24 : def.kind === "terminal" ? 0x22d3ee : 0xf59e0b;

  // Floating subtle holographic waypoint crystal above unfinished props
  const beaconMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 3.0,
    roughness: 0.18,
  });
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.095, 0), beaconMat);
  beacon.position.set(0, 1.72, 0);
  grp.add(beacon);

  let spinObj: THREE.Object3D | null = null;
  const stealables: THREE.Object3D[] = [];
  const laserMeshes: THREE.Mesh[] = [];
  let screenMesh: THREE.Mesh | null = null;
  let sideScreenMesh: THREE.Mesh | null = null;
  let glassHood: THREE.Group | null = null;
  let spotBeam: THREE.Mesh | null = null;
  let statusLed: THREE.MeshStandardMaterial | null = null;
  let lastPctBucket = -1;

  if (def.kind === "terminal") {
    /* ---------- CYBERSECURITY COMMAND WORKSTATION ---------- */
    // Chamfered walnut-ebony tabletop + steel A-frame legs
    const top = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.055, 0.78, 3, 0.018), walnutMat);
    top.position.y = 0.76;
    top.castShadow = true;
    top.receiveShadow = true;
    grp.add(top);

    for (const sx of [-0.64, 0.64]) {
      for (const sz of [-0.3, 0.3]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.022, 0.74, 10), darkSteel);
        leg.position.set(sx, 0.37, sz);
        leg.castShadow = true;
        grp.add(leg);
      }
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.03, 0.68, 2, 0.01), darkSteel);
      foot.position.set(sx, 0.015, 0);
      grp.add(foot);
    }
    const crossBar = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.04, 0.04), darkSteel);
    crossBar.position.set(0, 0.24, -0.22);
    grp.add(crossBar);

    // Desk mat + backlit mechanical keyboard + wireless mouse
    const mat = new THREE.Mesh(
      new RoundedBoxGeometry(0.84, 0.008, 0.34, 2, 0.003),
      new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.92 }),
    );
    mat.position.set(0.06, 0.79, 0.14);
    grp.add(mat);

    const kbBase = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.022, 0.145, 2, 0.006), darkSteel);
    kbBase.position.set(-0.04, 0.803, 0.14);
    kbBase.rotation.x = 0.06;
    grp.add(kbBase);

    const keycapGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.38, 0.115),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x22d3ee, emissiveIntensity: 0.85 }),
    );
    keycapGlow.rotation.x = -Math.PI / 2 + 0.06;
    keycapGlow.position.set(-0.04, 0.816, 0.14);
    grp.add(keycapGlow);

    const mouse = new THREE.Mesh(new RoundedBoxGeometry(0.065, 0.028, 0.11, 3, 0.012), darkSteel);
    mouse.position.set(0.31, 0.806, 0.15);
    grp.add(mouse);

    // Workstation Server Tower on left side of desk + glowing power/activity LEDs + USB key
    const tower = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.48, 0.46, 3, 0.02), darkSteel);
    tower.position.set(-0.54, 1.03, -0.05);
    tower.castShadow = true;
    grp.add(tower);

    const intake = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.38, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x0f1217, roughness: 0.7, metalness: 0.5 }),
    );
    intake.position.set(-0.54, 1.02, 0.18);
    grp.add(intake);

    statusLed = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 3.4 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), statusLed);
    led.position.set(-0.46, 1.21, 0.185);
    grp.add(led);

    const usb = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.015, 0.055),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 1.5 }),
    );
    usb.position.set(-0.58, 1.27, 0.15);
    grp.add(usb);

    // Dual-monitor aluminum VESA post + articulated arms
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.46, 12), brushedAlum);
    post.position.set(0.14, 1.01, -0.24);
    grp.add(post);

    // Primary widescreen display
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.48, 0.036, 2, 0.01), darkSteel);
    frame.position.set(0.08, 1.15, -0.17);
    grp.add(frame);

    const initTex = makeTerminalMainTex("MERIDIAN SECURE NODE", "HOLD [F] TO SCRUB", "#051520", "#22d3ee", -1);
    screenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.43),
      new THREE.MeshStandardMaterial({
        map: initTex,
        emissive: 0x22d3ee,
        emissiveMap: initTex,
        emissiveIntensity: 1.45,
        roughness: 0.18,
      }),
    );
    screenMesh.position.set(0.08, 1.15, -0.151);
    grp.add(screenMesh);

    // Secondary vertical telemetry monitor angled on right arm
    const sideGrp = new THREE.Group();
    sideGrp.position.set(0.56, 1.15, -0.09);
    sideGrp.rotation.y = -0.44;
    const sideFrame = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.46, 0.032, 2, 0.01), darkSteel);
    sideGrp.add(sideFrame);
    const sideTex = makeSideTelemetryTex();
    sideScreenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.42),
      new THREE.MeshStandardMaterial({
        map: sideTex,
        emissive: 0x38bdf8,
        emissiveMap: sideTex,
        emissiveIntensity: 1.35,
        roughness: 0.18,
      }),
    );
    sideScreenMesh.position.z = 0.017;
    sideGrp.add(sideScreenMesh);
    grp.add(sideGrp);

    // Subtle cyan screen spill pool across the desk
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 0.65),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0.12, 0.79, 0.04);
    grp.add(spill);
  } else if (def.kind === "files") {
    /* ---------- SPY BRIEFCASE & CLASSIFIED DOSSIERS ---------- */
    const tableTop = new THREE.Mesh(new RoundedBoxGeometry(1.22, 0.05, 0.74, 3, 0.016), walnutMat);
    tableTop.position.y = 0.76;
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    grp.add(tableTop);

    for (const sx of [-0.52, 0.52]) {
      for (const sz of [-0.29, 0.29]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.74, 10), darkSteel);
        leg.position.set(sx, 0.37, sz);
        leg.castShadow = true;
        grp.add(leg);
      }
    }

    // Charcoal leather desk blotter pad
    const blotter = new THREE.Mesh(
      new RoundedBoxGeometry(1.06, 0.008, 0.58, 2, 0.003),
      new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.88 }),
    );
    blotter.position.y = 0.788;
    grp.add(blotter);

    // Zero-Halliburton style brushed-aluminum spy briefcase
    const caseGrp = new THREE.Group();
    caseGrp.position.set(-0.2, 0.792, 0.02);
    caseGrp.rotation.y = 0.18;
    grp.add(caseGrp);
    stealables.push(caseGrp);

    const caseMat = new THREE.MeshStandardMaterial({ color: 0xb8c2ce, roughness: 0.24, metalness: 0.88 });
    const caseBody = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.145, 0.38, 4, 0.026), caseMat);
    caseBody.position.y = 0.072;
    caseBody.castShadow = true;
    caseGrp.add(caseBody);

    // Structural lid ribs + brass combination locks + ergonomic handle
    for (const rz of [-0.09, 0.0, 0.09]) {
      const rib = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.01, 0.022, 2, 0.004), brushedAlum);
      rib.position.set(0, 0.146, rz);
      caseGrp.add(rib);
    }
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.22, metalness: 0.92 });
    for (const lx of [-0.14, 0.14]) {
      const latch = new THREE.Mesh(new RoundedBoxGeometry(0.065, 0.036, 0.024, 2, 0.005), brassMat);
      latch.position.set(lx, 0.082, 0.194);
      caseGrp.add(latch);
    }
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.025, 0.045, 2, 0.008), darkSteel);
    handle.position.set(0, 0.078, 0.212);
    caseGrp.add(handle);

    // Blinking RF security tag on briefcase corner
    statusLed = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 2.8 });
    const tag = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), statusLed);
    tag.position.set(0.21, 0.148, 0.14);
    caseGrp.add(tag);

    // Layered TOP SECRET dossiers with fanned-out paper sheets + encrypted drive
    const docGrp = new THREE.Group();
    docGrp.position.set(0.26, 0.794, -0.02);
    docGrp.rotation.y = -0.22;
    grp.add(docGrp);
    stealables.push(docGrp);

    const paperMat = new THREE.MeshStandardMaterial({ color: 0xf3f0e6, roughness: 0.85 });
    const sheets = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.024, 0.34), paperMat);
    sheets.position.set(0.01, 0.012, 0.005);
    sheets.rotation.y = 0.08;
    docGrp.add(sheets);

    const dossierTex = makeDossierTex();
    const folderMat = new THREE.MeshStandardMaterial({ map: dossierTex, roughness: 0.72 });
    const folder = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.014, 0.35, 2, 0.004), folderMat);
    folder.position.set(0, 0.032, 0);
    docGrp.add(folder);

    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.016, 0.02), brushedAlum);
    clip.position.set(-0.09, 0.04, -0.15);
    docGrp.add(clip);

    // Encrypted external SSD drive beside dossiers
    const ssd = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.02, 0.16, 2, 0.006), darkSteel);
    ssd.position.set(0.18, 0.01, 0.11);
    ssd.rotation.y = 0.35;
    docGrp.add(ssd);

    // Subtle warm inspection desk lamp casting a pool onto the briefcase & classified dossiers
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.025, 12), darkSteel);
    lampBase.position.set(-0.46, 0.80, -0.22);
    grp.add(lampBase);
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.28, 8), brushedAlum);
    lampStem.position.set(-0.46, 0.94, -0.22);
    grp.add(lampStem);
    const lampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.095, 0.09, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
    );
    lampShade.position.set(-0.4, 1.07, -0.18);
    lampShade.rotation.z = -0.35;
    lampShade.rotation.x = 0.25;
    grp.add(lampShade);
    const lampBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfde68a, emissiveIntensity: 2.6 }),
    );
    lampBulb.position.set(-0.39, 1.04, -0.17);
    grp.add(lampBulb);
    const deskPool = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.56),
      new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    deskPool.rotation.x = -Math.PI / 2;
    deskPool.position.set(0.02, 0.793, 0.02);
    grp.add(deskPool);
  } else if (def.kind === "diamond") {
    /* ---------- HIGH-SECURITY MUSEUM DIAMOND VITRINE ---------- */
    const isBloodStar = /blood/i.test(def.label);
    const gemTint = isBloodStar ? 0xffe4ec : 0xe0f7ff;
    const gemGlow = isBloodStar ? 0xf43f5e : 0x38bdf8;
    const laserCol = isBloodStar ? 0xf43f5e : 0x22d3ee;

    const marbleMat = new THREE.MeshStandardMaterial({ color: 0x151820, roughness: 0.22, metalness: 0.45 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.26, metalness: 0.9 });

    // Tiered obsidian marble & brass security pedestal
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(0.88, 0.12, 0.88, 3, 0.025), marbleMat);
    plinth.position.y = 0.06;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    grp.add(plinth);

    const column = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.78, 0.68, 3, 0.03), marbleMat);
    column.position.y = 0.51;
    column.castShadow = true;
    column.receiveShadow = true;
    grp.add(column);

    const collar = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.045, 0.74, 2, 0.012), brassMat);
    collar.position.y = 0.91;
    grp.add(collar);

    const topPlate = new THREE.Mesh(new RoundedBoxGeometry(0.76, 0.05, 0.76, 3, 0.016), marbleMat);
    topPlate.position.y = 0.955;
    grp.add(topPlate);

    // Engraved museum brass nameplate
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.105),
      new THREE.MeshStandardMaterial({ map: makePlaqueTex(def.label), roughness: 0.35, metalness: 0.7 }),
    );
    plaque.position.set(0, 0.74, 0.343);
    grp.add(plaque);

    // Crimson velvet display cushion
    const velvet = new THREE.Mesh(
      new RoundedBoxGeometry(0.38, 0.065, 0.38, 3, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x4c0519, roughness: 0.92 }),
    );
    velvet.position.y = 1.01;
    grp.add(velvet);

    // Brilliant-cut multi-faceted diamond
    const diamond = new THREE.Mesh(
      createBrilliantDiamondGeometry(0.18, 0.28),
      new THREE.MeshPhysicalMaterial({
        color: gemTint,
        emissive: gemGlow,
        emissiveIntensity: 1.55,
        roughness: 0.04,
        metalness: 0.12,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        iridescence: 0.9,
        flatShading: true,
      }),
    );
    diamond.position.y = 1.24;
    grp.add(diamond);
    spinObj = diamond;
    stealables.push(diamond);

    // Glass vitrine hood with titanium corner mullions
    glassHood = new THREE.Group();
    glassHood.position.y = 1.28;
    grp.add(glassHood);

    const glassPane = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.58, 0.56),
      new THREE.MeshPhysicalMaterial({
        color: 0xdbeafe,
        transparent: true,
        opacity: 0.22,
        roughness: 0.05,
        metalness: 0.1,
        clearcoat: 1.0,
        depthWrite: false,
      }),
    );
    glassHood.add(glassPane);

    for (const sx of [-0.28, 0.28]) {
      for (const sz of [-0.28, 0.28]) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.6, 0.022), darkSteel);
        mullion.position.set(sx, 0, sz);
        glassHood.add(mullion);
      }
    }
    const hoodCap = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.03, 0.6, 2, 0.008), darkSteel);
    hoodCap.position.y = 0.295;
    glassHood.add(hoodCap);

    // 4 Corner security laser emitters + crisscrossing laser beams
    const laserMat = new THREE.MeshBasicMaterial({ color: laserCol, transparent: true, opacity: 0.55 });
    for (const [lx, lz] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]] as const) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.62, 8), darkSteel);
      post.position.set(lx, 1.28, lz);
      grp.add(post);
    }
    for (const ly of [1.14, 1.42]) {
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.92, 6), laserMat);
      b1.position.set(0, ly, 0);
      b1.rotation.z = Math.PI / 2;
      b1.rotation.y = Math.PI / 4;
      grp.add(b1);
      laserMeshes.push(b1);

      const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.92, 6), laserMat);
      b2.position.set(0, ly, 0);
      b2.rotation.z = Math.PI / 2;
      b2.rotation.y = -Math.PI / 4;
      grp.add(b2);
      laserMeshes.push(b2);
    }

    // Museum pin-spot subtle glow cone
    spotBeam = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.72, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: gemGlow, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    spotBeam.position.set(0, 1.32, 0);
    grp.add(spotBeam);
  } else {
    /* ---------- ARMORED VAULT CHEST & GOLD BULLION HEIRLOOM ---------- */
    const tableTop = new THREE.Mesh(new RoundedBoxGeometry(1.12, 0.055, 0.74, 3, 0.018), walnutMat);
    tableTop.position.y = 0.74;
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    grp.add(tableTop);

    for (const sx of [-0.48, 0.48]) {
      for (const sz of [-0.28, 0.28]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.022, 0.72, 10), darkSteel);
        leg.position.set(sx, 0.36, sz);
        leg.castShadow = true;
        grp.add(leg);
      }
    }

    // Heavy-duty open armored Pelican/vault bullion chest
    const chestLower = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.22, 0.56, 3, 0.03), darkSteel);
    chestLower.position.y = 0.875;
    chestLower.castShadow = true;
    grp.add(chestLower);

    // Velvet foam liner inside open chest
    const foam = new THREE.Mesh(
      new RoundedBoxGeometry(0.78, 0.04, 0.48, 2, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95 }),
    );
    foam.position.y = 0.975;
    grp.add(foam);

    // Hinged open chest lid + warm interior lid light strip so gold gleams at night
    const lid = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.09, 0.56, 3, 0.03), darkSteel);
    lid.position.set(0, 1.24, -0.34);
    lid.rotation.x = -1.82;
    grp.add(lid);

    const lidLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.02, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfde68a, emissiveIntensity: 2.4 }),
    );
    lidLed.position.set(0, 1.42, -0.25);
    grp.add(lidLed);

    const chestPool = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.46),
      new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    chestPool.rotation.x = -Math.PI / 2;
    chestPool.position.set(0, 0.998, 0);
    grp.add(chestPool);

    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.38, 0.095),
      new THREE.MeshStandardMaterial({ map: makePlaqueTex("THORNE BULLION"), roughness: 0.35, metalness: 0.7 }),
    );
    plaque.position.set(0, 0.88, 0.282);
    grp.add(plaque);

    // Stamped trapezoidal cast 999.9 gold bullion pyramid (3 + 2 + 1)
    const goldTex = makeBullionStampTex();
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd152,
      map: goldTex,
      emissive: 0xd97706,
      emissiveIntensity: 0.78,
      roughness: 0.16,
      metalness: 0.96,
    });
    const ingotGeo = createBullionIngotGeometry(0.15, 0.078, 0.31);

    const ingotCoords: [number, number, number][] = [
      [-0.2, 0.99, 0.0],
      [0.0, 0.99, 0.0],
      [0.2, 0.99, 0.0],
      [-0.1, 1.072, 0.0],
      [0.1, 1.072, 0.0],
      [0.0, 1.154, 0.0],
    ];
    for (const [bx, by, bz] of ingotCoords) {
      const bar = new THREE.Mesh(ingotGeo, goldMat);
      bar.position.set(bx, by, bz);
      bar.castShadow = true;
      grp.add(bar);
      stealables.push(bar);
    }

    // Gleaming Gold Sovereign Signet Medallion in front slot
    const medal = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 24), goldMat);
    medal.position.set(0, 1.01, 0.19);
    medal.rotation.x = 0.22;
    grp.add(medal);
    stealables.push(medal);
    spinObj = medal;
  }

  let t = Math.random() * 6;
  const inst: InteractableInstance = {
    def,
    group: grp,
    pos: new THREE.Vector3(def.x, baseY, def.z),
    done: false,
    update: (dt: number) => {
      if (inst.done) return;
      t += dt;
      beacon.rotation.y += dt * 2.2;
      beacon.position.y = 1.72 + Math.sin(t * 3.0) * 0.065;
      if (spinObj && def.kind === "diamond") {
        spinObj.rotation.y += dt * 1.1;
        spinObj.position.y = 1.24 + Math.sin(t * 2.4) * 0.022;
      }
      if (statusLed) {
        statusLed.emissiveIntensity = Math.sin(t * 5.0) > 0 ? 3.5 : 0.6;
      }
    },
    setProgress: (p: number) => {
      if (inst.done) return;
      const clamped = Math.max(0, Math.min(1, p));
      if (def.kind === "terminal" && screenMesh) {
        const bucket = Math.round(clamped * 10);
        if (bucket !== lastPctBucket) {
          lastPctBucket = bucket;
          const tex = makeTerminalMainTex(
            "MERIDIAN SECURE NODE",
            clamped > 0.02 ? "WIPING STORAGE…" : "HOLD [F] TO SCRUB",
            "#051520",
            clamped > 0.02 ? "#fbbf24" : "#22d3ee",
            clamped > 0.02 ? clamped : -1,
          );
          const m = screenMesh.material as THREE.MeshStandardMaterial;
          m.map?.dispose();
          m.map = tex;
          m.emissiveMap = tex;
          m.emissive.setHex(clamped > 0.02 ? 0xfbbf24 : 0x22d3ee);
          m.needsUpdate = true;
        }
      }
      if (def.kind === "diamond" && laserMeshes.length > 0) {
        const active = clamped < 0.75;
        for (const lm of laserMeshes) lm.visible = active && Math.sin(t * 40) > -0.6;
      }
    },
    setDone: () => {
      if (inst.done) return;
      inst.done = true;
      beacon.visible = false;
      for (const s of stealables) s.visible = false;
      for (const lm of laserMeshes) lm.visible = false;
      if (spotBeam) spotBeam.visible = false;
      if (statusLed) {
        statusLed.color.setHex(0x10b981);
        statusLed.emissive.setHex(0x10b981);
        statusLed.emissiveIntensity = 1.2;
      }
      if (glassHood) {
        glassHood.position.y = 1.44;
        glassHood.rotation.z = 0.08;
      }
      if (screenMesh) {
        const wipedTex = makeTerminalMainTex("MERIDIAN SECURE NODE", "DATA SCRUBBED", "#04140d", "#10b981", 1);
        const m = screenMesh.material as THREE.MeshStandardMaterial;
        m.map?.dispose();
        m.map = wipedTex;
        m.emissiveMap = wipedTex;
        m.emissive.setHex(0x10b981);
        m.emissiveIntensity = 0.75;
        m.needsUpdate = true;
      }
      if (sideScreenMesh) {
        (sideScreenMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
      }
    },
  };
  return inst;
}
