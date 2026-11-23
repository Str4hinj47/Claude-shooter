/* ------------------------------------------------------------------ */
/*  INTERACTABLES — 3D heist & espionage props (scrub / steal / take) */
/* ------------------------------------------------------------------ */
import * as THREE from "three";
import type { InteractDef } from "./story";

export interface InteractableInstance {
  def: InteractDef;
  group: THREE.Group;
  pos: THREE.Vector3;
  done: boolean;
  update: (dt: number) => void;
  setDone: () => void;
}

function makeScreenTex(title: string, sub: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = fg;
  g.lineWidth = 3;
  g.strokeRect(8, 8, 240, 144);
  g.fillStyle = fg;
  g.font = "bold 18px monospace";
  g.fillText(title, 20, 42);
  g.font = "13px monospace";
  g.fillText(sub, 20, 72);
  g.fillStyle = "rgba(255,255,255,0.22)";
  for (let i = 0; i < 4; i++) {
    g.fillRect(20, 92 + i * 13, 180 - i * 24, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createInteractableProp(def: InteractDef): InteractableInstance {
  const grp = new THREE.Group();
  const baseY = def.y ?? 0;
  grp.position.set(def.x, baseY, def.z);
  if (def.ry) grp.rotation.y = def.ry;

  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1e232b, roughness: 0.48, metalness: 0.72 });
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.65, metalness: 0.25 });
  const accentColor =
    def.kind === "diamond" ? 0x38bdf8 : def.kind === "relic" ? 0xfbbf24 : def.kind === "terminal" ? 0x22d3ee : 0xf59e0b;

  const beaconMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 3.2,
    roughness: 0.2,
  });
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), beaconMat);
  beacon.position.set(0, 1.58, 0);
  grp.add(beacon);

  let spinObj: THREE.Object3D | null = null;
  let stealables: THREE.Object3D[] = [];
  let screenMesh: THREE.Mesh | null = null;
  let glassCase: THREE.Mesh | null = null;

  if (def.kind === "terminal") {
    // Tactical desk + server tower + dual glowing monitor terminal
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.78, 0.72), deskMat);
    desk.position.y = 0.39;
    desk.castShadow = true;
    desk.receiveShadow = true;
    grp.add(desk);

    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.48, 0.44), darkMetal);
    tower.position.set(-0.46, 1.02, -0.06);
    grp.add(tower);

    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.1), darkMetal);
    stand.position.set(0.1, 0.89, -0.14);
    grp.add(stand);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.44, 0.05), darkMetal);
    frame.position.set(0.1, 1.12, -0.14);
    grp.add(frame);

    const activeTex = makeScreenTex("CLASSIFIED NODE", "HOLD [F] TO SCRUB", "#071a26", "#22d3ee");
    const screenMat = new THREE.MeshStandardMaterial({
      map: activeTex,
      emissive: 0x22d3ee,
      emissiveMap: activeTex,
      emissiveIntensity: 1.55,
      roughness: 0.2,
    });
    screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.38), screenMat);
    screenMesh.position.set(0.1, 1.12, -0.113);
    grp.add(screenMesh);

    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.16), darkMetal);
    kb.position.set(0.1, 0.795, 0.14);
    grp.add(kb);
  } else if (def.kind === "files") {
    // Crate/table + brushed-metal spy briefcase + confidential folders
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.76, 0.7), deskMat);
    table.position.y = 0.38;
    table.castShadow = true;
    table.receiveShadow = true;
    grp.add(table);

    const caseMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.28, metalness: 0.88 });
    const briefcase = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.38), caseMat);
    briefcase.position.set(-0.14, 0.83, 0.02);
    briefcase.rotation.y = 0.18;
    grp.add(briefcase);

    const latchMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 0.92 });
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.04), latchMat);
    latch.position.set(-0.14, 0.85, 0.21);
    latch.rotation.y = 0.18;
    grp.add(latch);

    const folderMat = new THREE.MeshStandardMaterial({ color: 0xd8c398, roughness: 0.75 });
    const folder = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.34), folderMat);
    folder.position.set(0.28, 0.785, -0.02);
    folder.rotation.y = -0.22;
    grp.add(folder);

    const seal = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.01, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0x991b1b, emissiveIntensity: 0.8 }),
    );
    seal.position.set(0.28, 0.815, -0.02);
    seal.rotation.y = -0.22;
    grp.add(seal);

    stealables.push(briefcase, latch, folder, seal);
  } else if (def.kind === "diamond") {
    // Obsidian museum/vault pedestal + glass vitrine + glowing spinning cut diamond
    const ped = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.96, 0.74),
      new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.3, metalness: 0.55 }),
    );
    ped.position.y = 0.48;
    ped.castShadow = true;
    ped.receiveShadow = true;
    grp.add(ped);

    const velvet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.26, 0.06, 20),
      new THREE.MeshStandardMaterial({ color: 0x3b0d16, roughness: 0.9 }),
    );
    velvet.position.y = 0.99;
    grp.add(velvet);

    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.17, 0),
      new THREE.MeshStandardMaterial({
        color: 0xe0f7ff,
        emissive: 0x38bdf8,
        emissiveIntensity: 2.2,
        roughness: 0.06,
        metalness: 0.25,
      }),
    );
    diamond.position.y = 1.24;
    diamond.scale.set(1, 1.35, 1);
    grp.add(diamond);
    spinObj = diamond;
    stealables.push(diamond);

    glassCase = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.54, 0.56),
      new THREE.MeshStandardMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.26,
        roughness: 0.08,
        metalness: 0.15,
        depthWrite: false,
      }),
    );
    glassCase.position.y = 1.24;
    grp.add(glassCase);
  } else {
    // "relic" — Gold bullion & private collector case
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.84, 0.65), deskMat);
    ped.position.y = 0.42;
    ped.castShadow = true;
    ped.receiveShadow = true;
    grp.add(ped);

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xb45309,
      emissiveIntensity: 0.7,
      roughness: 0.22,
      metalness: 0.95,
    });
    for (let i = -1; i <= 1; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.34), goldMat);
      bar.position.set(i * 0.22, 0.895, 0);
      grp.add(bar);
      stealables.push(bar);
    }
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.34), goldMat);
    topBar.position.set(0, 1.005, 0);
    grp.add(topBar);
    stealables.push(topBar);
    spinObj = topBar;
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
      beacon.position.y = 1.58 + Math.sin(t * 3.0) * 0.07;
      if (spinObj && def.kind === "diamond") {
        spinObj.rotation.y += dt * 1.4;
        spinObj.position.y = 1.24 + Math.sin(t * 2.4) * 0.025;
      }
    },
    setDone: () => {
      if (inst.done) return;
      inst.done = true;
      beacon.visible = false;
      for (const s of stealables) s.visible = false;
      if (glassCase) {
        glassCase.position.y = 1.08;
        (glassCase.material as THREE.MeshStandardMaterial).opacity = 0.12;
      }
      if (screenMesh) {
        const wipedTex = makeScreenTex("DATA SCRUBBED", "0 BYTES REMAINING", "#05140c", "#10b981");
        const m = screenMesh.material as THREE.MeshStandardMaterial;
        m.map = wipedTex;
        m.emissiveMap = wipedTex;
        m.emissive.setHex(0x10b981);
        m.emissiveIntensity = 0.7;
        m.needsUpdate = true;
      }
    },
  };
  return inst;
}
