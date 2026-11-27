import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";

// Minimal browser/localStorage stubs for headless Node testing
const memStore = new Map();
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => void memStore.set(k, String(v)),
  removeItem: (k) => void memStore.delete(k),
  clear: () => void memStore.clear(),
};

const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
await MeshoptDecoder.ready;

const {
  FIGHT_PIT_CENTER,
  FIGHT_PIT_TIERS,
  PIT_ROSTER,
  UndergroundFightPit,
} = await import("../src/game/city/UndergroundFightPit.ts");
const {
  loadSave,
  recordFightPitBetResult,
  recordFightPitWin,
  resetFightPitStreak,
  spendPitCredits,
} = await import("../src/game/progression.ts");
const { sampleCombatBone } = await import("../src/character/CombatAnimations.ts");
const { upgradeCharacterMaterial } = await import("../src/character/SoldierRig.ts");

// 1. Verify all 11 Iron Pit GLB props + existing bookie/ringside props load cleanly
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const expectedGlbs = [
  "pit_barrel.glb",
  "pit_barrel_open.glb",
  "pit_barrier.glb",
  "pit_cash_register.glb",
  "pit_chair.glb",
  "pit_crate_stack.glb",
  "pit_floodlight.glb",
  "pit_pallet.glb",
  "pit_speaker.glb",
  "pit_stool.glb",
  "pit_trophy.glb",
  "int_table.glb",
  "pos_terminal.glb",
  "stash_bag.glb",
  "medkit.glb",
];
for (const f of expectedGlbs) {
  const buf = fs.readFileSync(`public/models/${f}`);
  const gltf = await loader.parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    "",
  );
  let meshCount = 0;
  gltf.scene.traverse((o) => {
    if (o.isMesh) meshCount++;
  });
  assert.ok(meshCount >= 1, `${f} should contain at least 1 mesh`);
}
console.log(`PASS: all ${expectedGlbs.length} Iron Pit 3D GLB props load cleanly`);

// 2. Verify UndergroundFightPit arena + fight card + betting persistence
assert.equal(FIGHT_PIT_CENTER.x, 722);
assert.equal(FIGHT_PIT_CENTER.z, 115);
assert.equal(FIGHT_PIT_TIERS.length, 5);
assert.ok(PIT_ROSTER.length >= 8);

const pit = new UndergroundFightPit(() => 2.5, 0, 0);
assert.ok(pit.colliders.length >= 10, "Pit should build perimeter, bleachers, rack, and bag colliders");
const info = pit.getBookieInfo();
assert.equal(info.fightCard.length, 3, "Bookie should generate a 3-bout fight card");
for (const m of info.fightCard) {
  assert.ok(m.redOdds >= 1.25 && m.redOdds <= 4.0, `Valid red odds: ${m.redOdds}`);
  assert.ok(m.blueOdds >= 1.25 && m.blueOdds <= 4.0, `Valid blue odds: ${m.blueOdds}`);
  assert.ok(m.koPropBonus > 0.3, `Valid KO prop bonus: ${m.koPropBonus}`);
}

const initialCredits = loadSave().currencies.credits;
assert.ok(initialCredits >= 100);
assert.equal(spendPitCredits(100).ok, true);
assert.equal(loadSave().currencies.credits, initialCredits - 100);
recordFightPitBetResult(100, 220);
assert.equal(loadSave().currencies.credits, initialCredits + 120);
assert.equal(loadSave().pitBetWins, 1);
assert.equal(loadSave().pitBetProfit, 120);

recordFightPitWin(0, 600);
assert.equal(loadSave().pitWinStreak, 1);
resetFightPitStreak();
assert.equal(loadSave().pitWinStreak, 0);
console.log("PASS: Iron Pit fight card, odds, wagering, and streak persistence work");

// 3. Verify 4-point C1 cubic quaternion interpolation continuity in sampleCombatBone
const qA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.0);
const qB = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
const qC = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.0);
const qD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.5);
const clip = {
  frames: 4,
  duration: 0.4,
  loop: false,
  pingPong: false,
  bones: {
    RightArm: new Float32Array([
      qA.x, qA.y, qA.z, qA.w,
      qB.x, qB.y, qB.z, qB.w,
      qC.x, qC.y, qC.z, qC.w,
      qD.x, qD.y, qD.z, qD.w,
    ]),
  },
};
const outQ = new THREE.Quaternion();
for (let s = 0; s <= 20; s++) {
  const ok = sampleCombatBone(clip, "RightArm", s / 20, outQ);
  assert.equal(ok, true);
  assert.ok(Math.abs(outQ.length() - 1) < 1e-4, "Sampled quaternion must remain unit length");
}
console.log("PASS: sampleCombatBone C1 cubic spherical interpolation stays unit-normalized");

// 4. Verify non-shiny matte hair material upgrade
const rawHairMat = new THREE.MeshStandardMaterial({
  name: "Hair_short02",
  color: 0x1c1510,
  roughness: 0.62,
  metalness: 0,
});
const tunedHair = upgradeCharacterMaterial(rawHairMat);
assert.ok(tunedHair.roughness >= 0.9, `Hair roughness must be matte (>=0.9), got ${tunedHair.roughness}`);
assert.equal(tunedHair.metalness, 0);
assert.ok(tunedHair.specularIntensity <= 0.1, `Hair specularIntensity must be low, got ${tunedHair.specularIntensity}`);
assert.ok(tunedHair.envMapIntensity <= 0.15, `Hair envMapIntensity must be low, got ${tunedHair.envMapIntensity}`);
assert.ok(tunedHair.roughnessMap !== null, "Hair must receive fibrous strand roughnessMap");
assert.ok(tunedHair.bumpMap !== null, "Hair must receive fibrous strand bumpMap");
console.log("PASS: Fighter hair material upgraded to matte fibrous non-shiny shading");
