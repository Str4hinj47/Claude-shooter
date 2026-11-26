/* Phase 11 Gameplay Validation: Pistol Slot 1, Weapon Panic, Blood/Wounds, Body Carry, Trunk & Boat Ocean Disposal */

const ctxStub = new Proxy(
  {},
  {
    get: (_t, k) => {
      if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {} });
      if (k === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "getImageData") return (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "canvas") return { width: 256, height: 256 };
      return () => {};
    },
    set: () => true,
  },
);
globalThis.document = {
  createElement: (tag) => {
    if (tag === "canvas") return { width: 256, height: 256, getContext: () => ctxStub, style: {} };
    return { style: {} };
  },
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const THREE = await import("three");
const { WEAPONS, buildWeapon } = await import("../src/character/rifle.ts");
const { DEFAULT_WEAPON_CONFIGS, loadSave } = await import("../src/game/progression.ts");
const { CombatFX, Sfx } = await import("../src/game/fx.ts");
const {
  extractCorpseBoneRig,
  applyProceduralDeathPose,
  applyCarriedCorpsePose,
  applyBoatDeckPose,
} = await import("../src/game/city/CorpsePose.ts");
const { BodyCarrySystem } = await import("../src/game/city/BodyCarrySystem.ts");
const { PedestrianSystem } = await import("../src/game/city/PedestrianSystem.ts");
const { RoadNetwork } = await import("../src/game/city/RoadNetwork.ts");
const { populateWestgateRoads } = await import("../src/game/city/WestgateRoads.ts");
const { TrafficSignalManager } = await import("../src/game/city/TrafficSignals.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// 1. Arsenal & Pistol Slot 1
check(WEAPONS.length === 5, `Expected 5 weapons, got ${WEAPONS.length}`);
check(WEAPONS[0].id === "pistol" && WEAPONS[0].slot === 1, "Pistol must be Slot 1");
check(WEAPONS[0].suppressed === true, "Pistol must support suppressor");
const pistolBuild = buildWeapon(WEAPONS[0].id);
check(!!pistolBuild.group && !!pistolBuild.muzzle && !!pistolBuild.opticMount, "Pistol 3D build failed");
const loadedSave = loadSave();
check(Object.keys(loadedSave.weaponConfigs).length === 5 && !!loadedSave.weaponConfigs.pistol, "loadSave().weaponConfigs must include all 5 slots");
check(!!DEFAULT_WEAPON_CONFIGS.pistol, "DEFAULT_WEAPON_CONFIGS must include pistol");

// 2. Procedural mixamorig* Corpse Posing
function makeSyntheticCharacter() {
  const root = new THREE.Group();
  const makeBone = (name, parent) => {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  };
  const hips = makeBone("mixamorigHips", root);
  hips.position.y = 0.95;
  const spine = makeBone("mixamorigSpine", hips);
  const spine1 = makeBone("mixamorigSpine1", spine);
  const neck = makeBone("mixamorigNeck", spine1);
  makeBone("mixamorigHead", neck);
  const lArm = makeBone("mixamorigLeftArm", spine1);
  makeBone("mixamorigLeftForeArm", lArm);
  const rArm = makeBone("mixamorigRightArm", spine1);
  makeBone("mixamorigRightForeArm", rArm);
  const lUp = makeBone("mixamorigLeftUpLeg", hips);
  makeBone("mixamorigLeftLeg", lUp);
  const rUp = makeBone("mixamorigRightUpLeg", hips);
  makeBone("mixamorigRightLeg", rUp);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.7, 0.3), new THREE.MeshStandardMaterial());
  mesh.position.y = 0.85;
  root.add(mesh);
  return root;
}

const charModel = makeSyntheticCharacter();
const rig = extractCorpseBoneRig(charModel);
check(!!rig.bones.Hips && !!rig.bones.LeftArm && !!rig.bones.RightUpLeg, "CorpseBoneRig should capture mixamorig bones");
const deathPose = applyProceduralDeathPose(rig, 1.0, "back");
check(Number.isFinite(deathPose.pitch) && Math.abs(deathPose.pitch) > 1.2, "Death collapse should pitch body onto ground");
applyCarriedCorpsePose(rig, 0.2, 0.1, 0.05, 1.2);
check(Number.isFinite(rig.bones.LeftForeArm.quaternion.x), "Carried corpse pose should animate dangling forearms");
applyBoatDeckPose(rig, 0.5);
check(Number.isFinite(rig.bones.LeftUpLeg.quaternion.x), "Boat deck pose should curl legs cleanly");

// 3. Blood FX, Wound Patches & Water Splashes
const fxScene = new THREE.Scene();
const fx = new CombatFX(fxScene);
const sfx = new Sfx();
fx.bloodBurst(new THREE.Vector3(2, 1.2, 2), new THREE.Vector3(0, 0, 1), 1.3);
fx.spawnBloodPool(2, 2.2, 2, 0.9);
fx.bloodDrip(new THREE.Vector3(2, 1.3, 2), 2.2);
fx.attachWoundToCharacter(charModel, 1.15);
fx.waterSplash(new THREE.Vector3(-800, 0, 10), 1.2);
for (let i = 0; i < 10; i++) fx.update(0.05);
check(charModel.userData.__woundCount === 1, "Wound patch should attach onto character model");

// 4. Pedestrian Weapon Panic, Body Witness Indicators & Lethal Hit Handoff
const roads = new RoadNetwork();
populateWestgateRoads(roads);
roads.compile();
const terrainLand = (x, z) => (x < -500 ? -4.5 : 2.2);
const signals = new TrafficSignalManager(roads, terrainLand, []);
const peds = new PedestrianSystem(roads, terrainLand, signals);

let woundedCount = 0;
let killedCount = 0;
let brandishCount = 0;
let witnessCount = 0;
peds.onPedestrianWounded = () => woundedCount++;
peds.onPedestrianKilled = () => killedCount++;
peds.onWeaponBrandishedAtCop = () => brandishCount++;
peds.onBodyWitnessed = () => witnessCount++;

const civ = peds.agents.find((a) => a.roleId !== "police" && a.roleId !== "security");
check(!!civ, "Need a civilian pedestrian");
civ.x = 12;
civ.y = 2.2;
civ.z = 4;
civ.yaw = Math.PI; // facing -Z toward player at (12, 2.2, 0)
peds.updatePlayerAwareness(0.05, {
  x: 12,
  y: 2.2,
  z: 0,
  yaw: 0,
  weaponDrawn: true,
  ads: false,
  carryingBody: false,
  crouching: false,
});
check(civ.state === "flee", `Civilian should flee when weapon is unhidden nearby (got ${civ.state})`);

const cop = peds.agents.find((a) => a.roleId === "police" || a.roleId === "security") ?? peds.agents[1];
cop.roleId = "police";
cop.x = 12;
cop.y = 2.2;
cop.z = 5;
cop.yaw = Math.PI;
for (let i = 0; i < 45; i++) {
  peds.updatePlayerAwareness(0.05, {
    x: 12,
    y: 2.2,
    z: 0,
    yaw: 0,
    weaponDrawn: true,
    ads: true,
    carryingBody: false,
    crouching: false,
  });
}
check(brandishCount >= 1, "Police pedestrian should alert on drawn weapon");

// Oncoming body-carry witness check
civ.state = "walk";
civ.x = 20;
civ.y = 2.2;
civ.z = 12;
civ.yaw = Math.PI; // walking toward player at (20, 2.2, 0)
civ.witnessSuspicion = 0;
civ.witnessReported = false;
for (let i = 0; i < 65; i++) {
  peds.updatePlayerAwareness(0.05, {
    x: 20,
    y: 2.2,
    z: 0,
    yaw: 0,
    weaponDrawn: false,
    ads: false,
    carryingBody: true,
    crouching: false,
  });
}
check(peds.bodyWitnessIndicators.length > 0, "Carrying body near oncoming NPC must produce directional stealth indicators");
check(witnessCount >= 1, "Witness staring at carried body must report crime");

// Lethal shooting check
const targetPed = peds.agents[2];
targetPed.dead = false;
targetPed.hp = 60;
targetPed.x = 30;
targetPed.y = 2.2;
targetPed.z = 30;
peds.hitAtPoint(30, 3.1, 30, 0.8, 35);
check(woundedCount === 1 && !targetPed.dead, "First pistol hit should wound without instant death");
peds.hitAtPoint(30, 3.1, 30, 0.8, 35);
check(killedCount === 1 && targetPed.dead, "Second hit should kill pedestrian & trigger corpse handoff");

// 5. BodyCarrySystem: Pickup -> Car Trunk -> Retrieve -> Boat Deck -> Deep Ocean Dump
const carrySys = new BodyCarrySystem();
let oceanDisposedDeep = false;
let oceanDisposedCount = 0;
carrySys.onOceanDisposed = (_b, deep) => {
  oceanDisposedCount++;
  oceanDisposedDeep = deep;
};

const bodyRec = carrySys.registerDeadBody({
  roleId: "civilian",
  x: 10,
  y: 2.2,
  z: 10,
  yaw: 0,
  model: makeSyntheticCharacter(),
});
check(carrySys.bodies.length === 1, "Dead body should be registered");
// Collapse animation advance (> 1.15s)
for (let i = 0; i < 26; i++) {
  carrySys.update(0.05, new THREE.Vector3(10, 2.2, 10), 0, false, false, [], [], () => 2.2, terrainLand, fx, sfx);
}
check(bodyRec.state === "ground", "Dead body should settle into ground state");

const nearBody = carrySys.findNearestGroundBody(new THREE.Vector3(10.8, 2.2, 10.5));
check(nearBody === bodyRec, "Player near corpse should find body for [G] pickup");
check(carrySys.pickUpBody(bodyRec) && carrySys.isCarrying, "pickUpBody should start carrying state");

// Update while carrying (spring-damper + blood drips)
for (let i = 0; i < 15; i++) {
  carrySys.update(0.05, new THREE.Vector3(12, 2.2, 10), 0.3, false, false, [], [], () => 2.2, terrainLand, fx, sfx);
}
check(bodyRec.state === "carried", "Body should remain in carried state");

// Car trunk stash & retrieve
const fakeCar = {
  id: 1,
  pos: new THREE.Vector3(12, 2.2, 12.2),
  yaw: 0,
  length: 4.5,
  width: 1.9,
  height: 1.5,
  root: new THREE.Group(),
  trunkBodies: [],
};
const nearTrunk = carrySys.findNearestTrunkVehicle(new THREE.Vector3(12, 2.2, 9.7), [fakeCar]);
check(nearTrunk === fakeCar, "Player behind car should detect trunk");
check(carrySys.stashInTrunk(fakeCar, fx, sfx) && !carrySys.isCarrying && fakeCar.trunkBodies.length === 1, "Body should stash into car trunk");
check(carrySys.takeFromTrunk(fakeCar, sfx) && carrySys.isCarrying && fakeCar.trunkBodies.length === 0, "Body should retrieve from car trunk");

// Boat deck stow & ocean dump
const fakeBoat = {
  id: 7,
  name: "Sunseeker Speedboat",
  pos: new THREE.Vector3(-750, 0, 20),
  yaw: 0,
  root: new THREE.Group(),
  stowedBody: null,
};
check(carrySys.boardBoatWithCarriedBody(fakeBoat) && !carrySys.isCarrying && fakeBoat.stowedBody === bodyRec, "Body should stow onto boat deck");
carrySys.update(0.05, fakeBoat.pos, 0, false, true, [], [fakeBoat], () => 0, terrainLand, fx, sfx);
check(carrySys.dumpBodyIntoWater(fakeBoat, fakeBoat.pos, fakeBoat.yaw, fx, sfx), "dumpBodyIntoWater should throw body overboard");
check(fakeBoat.stowedBody === null && bodyRec.state === "sinking", "Overboard body should enter sinking state");
for (let i = 0; i < 80; i++) {
  carrySys.update(0.05, fakeBoat.pos, 0, false, true, [], [fakeBoat], () => 0, terrainLand, fx, sfx);
}
check(oceanDisposedCount === 1 && oceanDisposedDeep, "Body dumped offshore should sink and trigger onOceanDisposed(deepSea=true)");
check(bodyRec.state === "disposed" && !bodyRec.root.visible && !bodyRec.root.parent, "Disposed body should hide & detach cleanly after sinking");

if (failures.length > 0) {
  console.error("Phase 11 failures:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log("✔ Phase 11 tests passed: Pistol slot 1, procedural CorpsePose, blood/wounds, weapon panic, body-carry stealth indicators, car trunk stash/retrieve, and boat ocean disposal");
