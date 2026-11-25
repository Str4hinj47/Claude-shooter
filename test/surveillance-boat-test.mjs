import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, port: 0 },
  appType: "custom",
});

try {
  const progression = await server.ssrLoadModule("/src/game/progression.ts");
  const boatMod = await server.ssrLoadModule("/src/game/vehicles/water/BoatSystem.ts");
  const terrainMod = await server.ssrLoadModule("/src/game/city/WestgateTerrain.ts");
  const survMod = await server.ssrLoadModule("/src/game/city/ContractSurveillance.ts");
  const bodyMod = await server.ssrLoadModule("/src/game/city/BodyCarrySystem.ts");
  const roadMod = await server.ssrLoadModule("/src/game/city/RoadNetwork.ts");
  const westRoadsMod = await server.ssrLoadModule("/src/game/city/WestgateRoads.ts");
  const pedMod = await server.ssrLoadModule("/src/game/city/PedestrianSystem.ts");
  const wantedMod = await server.ssrLoadModule("/src/game/city/WantedSystem.ts");
  const vehMod = await server.ssrLoadModule("/src/game/city/VehicleSystem.ts");
  const openWorldMod = await server.ssrLoadModule("/src/game/city/OpenWorldEngine.ts");

  // 1. Default starter boat & starter car in SaveData
  const save = progression.loadSave();
  assert.ok(save.ownedCars.includes("golf"), "Starter Golf should be owned by default");
  assert.ok(save.ownedBoats.includes("skiff"), "Starter Skiff boat should be owned by default");
  assert.equal(save.selectedBoat, "skiff");

  // 2. Terrain + Road bridge
  const roads = new roadMod.RoadNetwork();
  westRoadsMod.populateWestgateRoads(roads);
  roads.compile();
  const terrainAt = terrainMod.buildWestgateTerrainFn(roads);
  const groundAt = (x, z, _y) => Math.max(0, terrainAt(x, z));

  // 3. Starter boat sits in water near Pacific Marina Dock
  const boats = new boatMod.BoatSystem(terrainAt);
  const starter = boats.getStarterBoat();
  assert.ok(starter, "Starter boat should spawn");
  assert.equal(starter.id, "boat_starter");
  assert.ok(terrainAt(starter.pos.x, starter.pos.z) < 0.15, "Starter boat must float in water");

  const summoned = boats.summonStarterBoatNear(new THREE.Vector3(-705, 3, -180));
  assert.ok(summoned, "Starter boat summon should find coastal water");
  assert.ok(terrainAt(summoned.pos.x, summoned.pos.z) < -0.4, "Summoned boat must sit in navigable water");

  // 4. Verify all 3 Surveillance Contracts & scripts
  assert.equal(survMod.SURVEILLANCE_CONTRACTS.length, 3);
  for (const c of survMod.SURVEILLANCE_CONTRACTS) {
    assert.ok(c.colleagues.length >= 4, `${c.id} must have >=4 colleague/neighbor NPCs`);
    assert.equal(c.schedule.length, 6, `${c.id} must have 6 daily routine phases`);
    const isolatedPhases = c.schedule.filter((p) => p.isolatedWindow);
    assert.ok(isolatedPhases.length >= 2, `${c.id} must have >=2 isolated strike windows`);
    for (const ph of c.schedule) {
      assert.ok(ph.scriptLines.length >= 1, `${ph.id} must have scripted dialogue`);
      const py = terrainAt(ph.parkX, ph.parkZ);
      const sy = terrainAt(ph.spotX, ph.spotZ);
      assert.ok(py > 1.5, `${ph.id} parking (${ph.parkX},${ph.parkZ}) must be on dry land (got ${py})`);
      assert.ok(sy > 0.4, `${ph.id} spot (${ph.spotX},${ph.spotZ}) must be above waterline (got ${sy})`);
    }
  }

  // 5. End-to-end Surveillance -> Driving -> Isolated Strike -> Boat Ocean Disposal
  const dummyScene = new THREE.Scene();
  const engine = new openWorldMod.OpenWorldEngine(dummyScene, () => {}, () => {});
  const vehMgr = new vehMod.WestgateVehicleManager(engine);
  const peds = new pedMod.PedestrianSystem(roads, terrainAt, null);
  const bodyCarry = new bodyMod.BodyCarrySystem();
  const wanted = new wantedMod.WantedSystem(roads, terrainAt, groundAt, vehMgr.getModelLibrary());
  const surv = new survMod.ContractSurveillanceSystem(
    terrainAt,
    groundAt,
    vehMgr,
    peds,
    bodyCarry,
    wanted,
    peds.voices,
  );

  let completedPayload = null;
  surv.onContractCompleted = (info) => {
    completedPayload = info;
  };
  bodyCarry.onOceanDisposed = (body, deepSea) => {
    surv.handleOceanDisposed(body, deepSea);
  };

  const started = surv.startContract("hit_port_auditor", 7.1);
  assert.ok(started);
  assert.equal(surv.isActive, true);

  // Jump to Marcus Bell's isolated Eastgate Seaport inspection phase (14:00)
  surv.advanceDayHour(7.0);
  // Step simulation so his car drives and parks cleanly (or settles into phase)
  for (let i = 0; i < 40; i++) {
    surv.update(0.05, new THREE.Vector3(682, 3, 486), false);
  }
  const hud = surv.getHudState(new THREE.Vector3(682, 3, 486));
  assert.ok(hud && hud.phaseLabel.length > 0);

  // Move to isolated pier spot and eliminate target
  const targetHud = surv.getHudState(new THREE.Vector3(682, 3, 486));
  // Ensure target exits vehicle if still driving by stepping enough frames
  for (let i = 0; i < 900; i++) {
    surv.update(0.05, new THREE.Vector3(682, 3, 486), false);
    const st = surv.getHudState(new THREE.Vector3(682, 3, 486));
    if (st && st.targetTransit === "on_foot") break;
  }
  const onFootHud = surv.getHudState(new THREE.Vector3(682, 3, 486));
  assert.equal(onFootHud.targetTransit, "on_foot", "Target should arrive and walk on foot");

  // Verify Tactical Binocular target tagging & shootable CCTV cameras
  const origin = new THREE.Vector3(onFootHud.targetX + 35, 6, onFootHud.targetZ);
  const aimDir = new THREE.Vector3(
    onFootHud.targetX - origin.x,
    groundAt(onFootHud.targetX, onFootHud.targetZ, 10) + 1.1 - origin.y,
    onFootHud.targetZ - origin.z,
  ).normalize();
  assert.equal(surv.tagTargetFromAim(origin, aimDir), true, "Binoculars should tag target from range");

  const camHit = surv.hitAtPoint(
    564,
    groundAt(564, 428, 10) + 4.05,
    428,
    50,
    true,
    new THREE.Vector3(564, 2, 420),
  );
  assert.equal(camHit, true, "Shooting Eastgate Seaport CCTV camera should disable it");

  // Verify car brake sabotage on Marcus's parked Silver Blista Compact
  const carSabPrompt = surv.getNearbySabotagePrompt(
    new THREE.Vector3(onFootHud.vehicleX, 2, onFootHud.vehicleZ),
  );
  assert.ok(carSabPrompt && carSabPrompt.includes("Brakes"), "Should offer car brake sabotage near target vehicle");
  assert.equal(
    surv.trySabotage(new THREE.Vector3(onFootHud.vehicleX, 2, onFootHud.vehicleZ)),
    true,
    "Car sabotage should arm cleanly",
  );
  assert.equal(
    surv.getHudState(new THREE.Vector3(onFootHud.vehicleX, 2, onFootHud.vehicleZ)).carSabotaged,
    true,
  );

  // Start fresh H1 pier window (13:50) to verify signature crane winch accident kill -> ocean disposal
  surv.startContract("hit_port_auditor", 13.85);
  const sabPrompt = surv.getNearbySabotagePrompt(new THREE.Vector3(672, 2, 478));
  assert.ok(sabPrompt && sabPrompt.includes("Crane"), "Should offer crane sabotage prompt near H1 pier winch");
  assert.equal(surv.trySabotage(new THREE.Vector3(672, 2, 478)), true, "Crane sabotage should execute accident kill");
  assert.equal(surv.currentStage, "dispose", "Rigged crane should execute accident kill and enter disposal stage");
  assert.equal(bodyCarry.bodies.length, 1, "Target corpse must register in BodyCarrySystem");

  // Verify PropBatcher shootable fire hydrant geyser
  const { PropBatcher } = await server.ssrLoadModule("/src/game/city/PropBatcher.ts");
  const pb = new PropBatcher();
  pb.registerPrototype({ id: "hydrant", parts: [] });
  pb.addInstance("hydrant", { x: 10, y: 1.5, z: 20 });
  assert.ok(pb.hitHydrantAtPoint(10.1, 2.0, 20.1, 100), "Shooting fire hydrant should trigger pressurized geyser");
  assert.equal(pb.getActiveHydrants(105, 12, 22).length, 1, "Hydrant geyser should stay active for 12s");

  // Carry body -> board starter boat -> dump into deep Pacific ocean
  assert.equal(bodyCarry.pickUpBody(bodyCarry.bodies[0]), true, "Player can pick up target corpse");
  assert.equal(bodyCarry.boardBoatWithCarriedBody(starter), true, "Player can board Starter Boat with corpse");

  // Sail boat into deep Pacific water (-900, 280) and dump overboard
  starter.pos.set(-900, 0, 280);
  const dumped = bodyCarry.dumpBodyIntoWater(starter, starter.pos, starter.yaw);
  assert.ok(dumped, "Body dumped from boat into water");

  // Step BodyCarrySystem until body sinks and triggers onOceanDisposed
  for (let i = 0; i < 240; i++) {
    bodyCarry.update(
      0.05,
      starter.pos,
      starter.yaw,
      false,
      true,
      [],
      boats.boats,
      groundAt,
      terrainAt,
    );
    if (completedPayload) break;
  }
  assert.ok(completedPayload, "Dumping target body in ocean should complete the surveillance contract");
  assert.equal(completedPayload.deepSea, true, "Offshore boat dump should award Deep Sea bonus");
  assert.ok(completedPayload.totalReward >= 4500, "Total reward should include base + disposal bonuses");

  console.log("PASS surveillance-boat-test", {
    starterBoat: starter.id,
    contract: completedPayload.def.id,
    totalReward: completedPayload.totalReward,
    unseen: completedPayload.unseen,
    deepSea: completedPayload.deepSea,
  });
} finally {
  await server.close();
}
