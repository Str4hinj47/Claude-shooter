import * as THREE from "three";
import { buildMissionCompoundAt, type EmbeddedMissionCompound, type LevelResult } from "../levels";
import { OPEN_WORLD_MISSION_SITES } from "./OpenWorldMissions";
import { OpenWorldEngine } from "./OpenWorldEngine";
import { buildWestgateTerrainFn, buildWestgateTerrainMesh, buildWestgateGrass, getDistrictAt, setTerrainWeather } from "./WestgateTerrain";
import { buildWestgateRoadLandmarks, populateWestgateRoads, setBridgeLandmarkDarkness } from "./WestgateRoads";
import { buildWestgateWater } from "./WestgateWater";
import { createRealisticSky, type RealisticSkyState } from "./RealisticSky";
import { CityChunkDispatcher, setCityLightingDarkness } from "./CityBuildingKit";
import { registerDowntownDistrict } from "./DowntownDistrict";
import { registerMidtownDistrict } from "./MidtownDistrict";
import { registerOldQuarterDistrict } from "./OldQuarterDistrict";
import { registerWestCoastDistrict } from "./WestCoastDistrict";
import { registerFoothillsDistrict } from "./FoothillsDistrict";
import { registerPortAirportDistrict } from "./PortAirportDistrict";
import { registerWestgateInfill } from "./WestgateInfill";
import { populateWestgateProps, setStreetlightDarkness, upgradeWestgatePropsWithGlbs } from "./WestgateProps";
import { WestgateVehicleManager } from "./VehicleSystem";
import { TrafficSignalManager } from "./TrafficSignals";
import { PedestrianSystem } from "./PedestrianSystem";
import { LivingWorldController } from "./LivingWorld";
import { WildlifeSystem } from "./WildlifeSystem";
import { buildMinimapData, type MinimapData } from "./MinimapData";
import { WestgateActivityManager } from "./WestgateActivities";
import { WantedSystem } from "./WantedSystem";
import { CityShopsManager } from "./CityShops";
import { RandomEventsManager } from "./RandomEvents";
import { CollectiblesSystem } from "./CollectiblesSystem";
import { BodyCarrySystem } from "./BodyCarrySystem";
import { ContractSurveillanceSystem } from "./ContractSurveillance";
import { UndergroundFightPit } from "./UndergroundFightPit";
import { AirVehicleSystem } from "../vehicles/air/AirVehicleSystem";
import { BoatSystem } from "../vehicles/water/BoatSystem";
import { buildWestgateApartments, type ApartmentSystem } from "./Apartments";
import { loadSave } from "../progression";
import { getLauncherProfile } from "../launcherConfig";
import {
  createWeatherState,
  stepWeather,
  weatherGrip,
  weatherLabel,
  type WeatherMode,
  type WeatherState,
} from "../vehicles/weather";
import { Precipitation } from "../vehicles/Precipitation";
import { RoadSpray, type TireSurfaceKind } from "../vehicles/RoadSpray";

import {
  TIME_OF_DAY_LABELS,
  TIME_OF_DAY_MODES,
  WESTGATE_SPAWN,
  WESTGATE_TELEPORTS,
  type TimeOfDayMode,
  type WestgateTeleportSpot,
} from "./WestgateMeta";
import {
  SAFEHOUSE_ORIGIN,
  SAFEHOUSE_YAW,
  registerSafehouseGarageSpatial,
  resetSafehouseGarageDoorState,
  updateSafehouseGarageDoor,
} from "./SafehouseResidence";

export {
  TIME_OF_DAY_LABELS,
  TIME_OF_DAY_MODES,
  WESTGATE_SPAWN,
  WESTGATE_TELEPORTS,
  type TimeOfDayMode,
  type WestgateTeleportSpot,
};

export interface WestgateLevelResult extends LevelResult {
  openWorld: OpenWorldEngine;
  vehicles: WestgateVehicleManager;
  activities: WestgateActivityManager;
  apartments: ApartmentSystem;
  minimapData: MinimapData;
  getDistrictAt: typeof getDistrictAt;
  weather: WeatherState;
  setWeatherMode: (mode: WeatherMode) => void;
  getWeatherLabel: () => string;
  getWeatherGrip: () => number;
  timeOfDay: TimeOfDayMode;
  setTimeOfDay: (mode: TimeOfDayMode) => void;
  getTimeOfDayDarkness: () => number;
  updateWeatherFx: (
    dt: number,
    camPos: THREE.Vector3,
    camera: THREE.Camera,
    speed: number,
    vehPos?: THREE.Vector3,
    vehYaw?: number,
    vehWidth?: number,
    vehLength?: number,
    wheelSlip?: number,
    surfaceKind?: TireSurfaceKind,
  ) => void;
}

export function buildWestgateWorld(
  content: THREE.Object3D,
  main: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): WestgateLevelResult {
  // 1. Live pixel-sharp atmospheric sky dome + CubeCamera PMREM IBL
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - 42),
    THREE.MathUtils.degToRad(215),
  );
  const initialSkyState: RealisticSkyState = {
    zenith: 0x1a539c,
    midSky: 0x4b93d6,
    horizon: 0xb7d7eb,
    fogColor: 0xadd0e8,
    sunColor: 0xfff0d4,
    sunDir,
    moonDir: new THREE.Vector3(0.45, 0.55, -0.7).normalize(),
    nightMix: 0,
    sunsetMix: 0.08,
    cloudCover: 0.45,
    overcast: 0,
  };
  const mainSky = createRealisticSky(initialSkyState);
  content.add(mainSky.mesh);

  const skyScene = new THREE.Scene();
  const iblSky = createRealisticSky(initialSkyState);
  skyScene.add(iblSky.mesh);

  const gfxProfile = getLauncherProfile();
  const cubeRT = new THREE.WebGLCubeRenderTarget(gfxProfile.cubeSize, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 10000, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCache = new Map<string, THREE.WebGLRenderTarget>();
  const waterSkyHorizon = new THREE.Color(0xb7d7eb);
  const waterSkyZenith = new THREE.Color(0x1a539c);
  let waterNightMix = 0;
  let lastIblOvercastBucket = 0;
  const rebuildSkyAndIBL = (mode: TimeOfDayMode, overcastBucket = 0) => {
    const cacheKey = `${mode}:${overcastBucket}`;
    const cached = envCache.get(cacheKey);
    if (cached) {
      main.environment = cached.texture;
      cubeCam.update(renderer, skyScene);
      main.background = cubeRT.texture;
      return;
    }
    cubeCam.update(renderer, skyScene);
    main.background = cubeRT.texture;
    const rt = pmrem.fromCubemap(cubeRT.texture);
    envCache.set(cacheKey, rt);
    main.environment = rt.texture;
  };
  rebuildSkyAndIBL("afternoon", 0);
  main.environmentIntensity = 0.78;
  main.fog = new THREE.FogExp2(0xadd0e8, 0.00038);
  renderer.toneMappingExposure = 0.96;

  // 2. Dual-Cascade Directional Sun Rig (scaled by Launcher Graphics Profile)
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.74);
  sun.castShadow = gfxProfile.shadowsEnabled;
  sun.shadow.mapSize.set(gfxProfile.nearShadowSize, gfxProfile.nearShadowSize);
  const sc = sun.shadow.camera;
  sc.left = -26;
  sc.right = 26;
  sc.top = 26;
  sc.bottom = -26;
  sc.near = 5;
  sc.far = 280;
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 1.8;
  content.add(sun, sun.target);

  const sunFar = new THREE.DirectionalLight(0xfff1dc, 0.61);
  sunFar.castShadow = gfxProfile.shadowsEnabled && gfxProfile.farShadowEnabled;
  sunFar.shadow.mapSize.set(gfxProfile.farShadowSize, gfxProfile.farShadowSize);
  const scFar = sunFar.shadow.camera;
  scFar.left = -175;
  scFar.right = 175;
  scFar.top = 175;
  scFar.bottom = -175;
  scFar.near = 10;
  scFar.far = 520;
  sunFar.shadow.bias = -0.00055;
  sunFar.shadow.normalBias = 0.08;
  sunFar.shadow.radius = 2.4;
  content.add(sunFar, sunFar.target);

  const hemi = new THREE.HemisphereLight(0x9bc8ef, 0x564e3e, 0.68);
  content.add(hemi);

  // 3. OpenWorldEngine + District Chunk Dispatcher + 4-Tier Curved Road Skeleton
  const dispatcher = new CityChunkDispatcher();
  let terrainAt: (x: number, z: number) => number = () => 4.5;
  const engine = new OpenWorldEngine({
    chunkBuilder: (chunk) => dispatcher.buildChunk(chunk, terrainAt, engine.roads),
    chunkOptions: {
      nearRadius: gfxProfile.nearRadius,
      lodRadius: gfxProfile.lodRadius,
      hysteresis: 28,
      maxBuildsPerFrame: gfxProfile.id === "safe" ? 1 : 2,
    },
  });
  populateWestgateRoads(engine.roads);
  engine.roads.compile();

  // 4. Terrain heightfield graded seamlessly around roads & roundabouts
  terrainAt = buildWestgateTerrainFn(engine.roads);
  engine.setTerrainFn(terrainAt);

  // Register Downtown (P2), Midtown (P3), Old Quarter (P4), West Coast (P5), Foothills (P6), Port/Airport (P7)
  registerDowntownDistrict(dispatcher, engine.roads, engine.heightSystem);
  registerMidtownDistrict(dispatcher, engine.roads, engine.heightSystem);
  registerOldQuarterDistrict(dispatcher, engine.roads, engine.heightSystem);
  registerWestCoastDistrict(dispatcher, engine.roads, engine.heightSystem);
  registerFoothillsDistrict(dispatcher, engine.roads, engine.heightSystem);
  registerPortAirportDistrict(dispatcher, engine.roads);
  registerWestgateInfill(dispatcher);

  const terrainMesh = buildWestgateTerrainMesh(terrainAt, 2400, 320);
  content.add(terrainMesh);
  engine.spatialColliders.addGlobal(terrainMesh);
  terrainMesh.updateMatrix();
  terrainMesh.matrixAutoUpdate = false;

  // 5. Animated Ocean / River / Harbor / Canal Water
  const water = buildWestgateWater(terrainAt, sunDir, 2400, 220);
  water.mesh.updateMatrix();
  water.mesh.matrixAutoUpdate = false;
  content.add(water.mesh);

  // 5b. Wind-swaying GPU-instanced grass tufts across parks, meadows & foothills
  const grass = buildWestgateGrass(terrainAt, engine.roads);
  content.add(grass.group);

  // 6. Roundabout islands & 5 architectural bridge superstructures
  const landmarkColliders: THREE.Object3D[] = [];
  buildWestgateRoadLandmarks(
    content,
    engine.roads,
    terrainAt,
    landmarkColliders,
    engine.spatialAABBs,
  );
  for (const c of landmarkColliders) {
    engine.spatialColliders.insert(c);
    c.updateMatrix();
    c.matrixAutoUpdate = false;
  }

  // 7. Populate citywide instanced trees, streetlights, signals, hydrants & parked cars (Phase 8)
  const streetlightPoints = populateWestgateProps(engine.props, engine.roads, terrainAt, WESTGATE_TELEPORTS);

  // 7b. Real-time night illumination: 2 active vehicle headlight SpotLights + 6 pooled streetlamp PointLights
  const headlightL = new THREE.SpotLight(0xeef6ff, 0, 56, 0.46, 0.65, 1.4);
  const headlightR = new THREE.SpotLight(0xeef6ff, 0, 56, 0.46, 0.65, 1.4);
  content.add(headlightL, headlightL.target, headlightR, headlightR.target);
  const streetLampPool: THREE.PointLight[] = [];
  for (let i = 0; i < 6; i++) {
    const pl = new THREE.PointLight(0xffcb78, 0, 26, 1.7);
    content.add(pl);
    streetLampPool.push(pl);
  }
  const bestLampIdx = new Int32Array(6).fill(-1);
  const bestLampD2 = new Float32Array(6).fill(Infinity);
  let lastLampFocusX = Infinity;
  let lastLampFocusZ = Infinity;

  // 8. Finalize roads, bridge WalkableSurfaces, props, and prewarm spawn chunks
  engine.finalizeStaticWorld(WESTGATE_SPAWN[0], WESTGATE_SPAWN[1]);
  registerSafehouseGarageSpatial(engine.spatialAABBs);

  // 8b. Embed all 6 campaign mission compounds directly inside Westgate Bay's city blocks
  const embeddedCompounds: Array<{ site: (typeof OPEN_WORLD_MISSION_SITES)[number]; comp: EmbeddedMissionCompound }> = [];
  const compoundDestroyables = new Map<number, THREE.Mesh[]>();
  const tmpCompBox = new THREE.Box3();
  for (const id of [1, 2, 3, 4, 5, 6] as const) {
    const site = OPEN_WORLD_MISSION_SITES[id];
    if (!site) continue;
    const comp = buildMissionCompoundAt(id, site);
    content.add(comp.root);
    engine.spatialAABBs.insertMany(comp.aabbs);
    for (const col of comp.colliders) {
      col.updateWorldMatrix(true, false);
      tmpCompBox.setFromObject(col);
      engine.spatialColliders.insert(col, tmpCompBox);
    }
    for (const ws of comp.walkableSurfaces) {
      engine.heightSystem.addSurface(ws);
    }
    compoundDestroyables.set(id, comp.destroyables);
    embeddedCompounds.push({ site, comp });
  }

  upgradeWestgatePropsWithGlbs(engine.props);
  content.add(engine.root);

  // 9. Spawn driveable Overtake car fleet & ambient NPC road traffic + Speed Traps + Signals + Pedestrians + Living World
  const signals = new TrafficSignalManager(engine.roads, terrainAt, WESTGATE_TELEPORTS, engine.spatialAABBs);
  content.add(signals.group);

  const pedestrians = new PedestrianSystem(engine.roads, terrainAt, signals);
  content.add(pedestrians.group);

  const bodyCarry = new BodyCarrySystem();
  content.add(bodyCarry.group);

  const livingWorld = new LivingWorldController(content);
  content.add(livingWorld.group);

  const vehicles = new WestgateVehicleManager(engine);
  vehicles.setWorldActors(signals, (x, z, fx, fz) => pedestrians.isPedestrianAhead(x, z, fx, fz));
  content.add(vehicles.root);
  const modelLib = vehicles.getModelLibrary();
  const activities = new WestgateActivityManager(terrainAt, engine.heightSystem, modelLib);
  content.add(activities.root);
  activities.root.updateMatrixWorld(true);
  for (const col of activities.colliders) {
    engine.spatialColliders.insert(col);
    const box = new THREE.Box3().setFromObject(col);
    if (!box.isEmpty()) engine.spatialAABBs.insert(box);
  }
  const shops = new CityShopsManager(terrainAt);
  content.add(shops.root);
  shops.root.updateMatrixWorld(true);
  for (const col of shops.colliders) {
    engine.spatialColliders.insert(col);
    const box = new THREE.Box3().setFromObject(col);
    if (!box.isEmpty()) engine.spatialAABBs.insert(box);
  }
  const wanted = new WantedSystem(
    engine.roads,
    terrainAt,
    (x, z, y) => engine.groundHeightAt(x, z, y),
    modelLib,
    engine.spatialAABBs,
  );
  content.add(wanted.group);
  const randomEvents = new RandomEventsManager(
    terrainAt,
    (x, z, y) => engine.groundHeightAt(x, z, y),
    modelLib,
  );
  content.add(randomEvents.group);
  const wildlife = new WildlifeSystem(
    terrainAt,
    (x, z, y) => engine.groundHeightAt(x, z, y),
  );
  content.add(wildlife.root);
  const aircraft = new AirVehicleSystem(
    terrainAt,
    (x, z, y) => engine.groundHeightAt(x, z, y),
  );
  content.add(aircraft.group);
  const boats = new BoatSystem(terrainAt);
  content.add(boats.group);
  const collectibles = new CollectiblesSystem(
    terrainAt,
    (x, z, y) => engine.groundHeightAt(x, z, y),
  );
  content.add(collectibles.group);
  const initialSave = loadSave();
  const fightPit = new UndergroundFightPit(terrainAt, initialSave.pitRank ?? 0, initialSave.pitWins ?? 0);
  content.add(fightPit.group);
  fightPit.group.updateMatrixWorld(true);
  for (const col of fightPit.colliders) {
    engine.spatialColliders.insert(col);
    const box = new THREE.Box3().setFromObject(col);
    if (!box.isEmpty()) engine.spatialAABBs.insert(box);
  }
  const contracts = new ContractSurveillanceSystem(
    terrainAt,
    (x: number, z: number, y: number) => engine.groundHeightAt(x, z, y),
    vehicles,
    pedestrians,
    bodyCarry,
    wanted,
    pedestrians.voices,
  );
  content.add(contracts.group);
  const apartments = buildWestgateApartments(engine);
  apartments.syncOwnership(initialSave.ownedApartments ?? []);
  apartments.syncGarageCars(initialSave, vehicles.getModelLibrary());
  vehicles.onModelLoaded = () => {
    apartments.syncGarageCars(loadSave(), vehicles.getModelLibrary());
  };
  content.add(apartments.group);
  const minimapData = buildMinimapData(engine.roads);

  // 10. Rain & snow precipitation + tire road spray + Time-of-Day lighting
  const weather = createWeatherState("auto");
  const precipitation = new Precipitation(main);
  precipitation.addShelterZone(SAFEHOUSE_ORIGIN.x, SAFEHOUSE_ORIGIN.y, SAFEHOUSE_ORIGIN.z, SAFEHOUSE_YAW, -20.1, 5.3, -6.7, 4.3, 8.8);
  precipitation.addShelterZone(SAFEHOUSE_ORIGIN.x, SAFEHOUSE_ORIGIN.y, SAFEHOUSE_ORIGIN.z, SAFEHOUSE_YAW, -9.2, 0.1, 3.5, 7.2, 4.0);
  const spray = new RoadSpray(main);
  const baseFogColor = new THREE.Color(0xadd0e8);
  const stormFogColor = new THREE.Color(0x6b7c8e);
  const snowFogColor = new THREE.Color(0xcbd6e2);
  let weatherElapsed = 0;

  const syncCityNightGlow = (darkness: number) => {
    setCityLightingDarkness(darkness);
    setStreetlightDarkness(darkness);
    setBridgeLandmarkDarkness(darkness);
  };

  let currentTimeOfDay: TimeOfDayMode = "afternoon";
  let todBaseSun = 2.25;
  let todBaseHemi = 0.68;
  let todDarkness = 0;

  const applyTimeOfDay = (mode: TimeOfDayMode) => {
    currentTimeOfDay = mode;
    let skyUpdate: Partial<RealisticSkyState>;
    if (mode === "afternoon") {
      sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 42), THREE.MathUtils.degToRad(215));
      baseFogColor.setHex(0xadd0e8);
      sun.color.setHex(0xfff1dc);
      hemi.color.setHex(0x9bc8ef);
      hemi.groundColor.setHex(0x564e3e);
      todBaseSun = 2.25;
      todBaseHemi = 0.68;
      todDarkness = 0;
      main.environmentIntensity = 0.78;
      renderer.toneMappingExposure = 0.96;
      skyUpdate = {
        zenith: 0x1a539c,
        midSky: 0x4b93d6,
        horizon: 0xb7d7eb,
        fogColor: 0xadd0e8,
        sunColor: 0xfff0d4,
        sunDir,
        nightMix: 0,
        sunsetMix: 0.08,
        cloudCover: 0.45,
      };
    } else if (mode === "sunset") {
      sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 9), THREE.MathUtils.degToRad(258));
      baseFogColor.setHex(0xd4876e);
      sun.color.setHex(0xff9f5a);
      hemi.color.setHex(0xc68899);
      hemi.groundColor.setHex(0x3b2d2b);
      todBaseSun = 1.65;
      todBaseHemi = 0.54;
      todDarkness = 0.58;
      main.environmentIntensity = 0.56;
      renderer.toneMappingExposure = 0.98;
      skyUpdate = {
        zenith: 0x18234a,
        midSky: 0x874569,
        horizon: 0xf49964,
        fogColor: 0xd4876e,
        sunColor: 0xffa45b,
        sunDir,
        nightMix: 0.08,
        sunsetMix: 1.0,
        cloudCover: 0.48,
      };
    } else if (mode === "night") {
      sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(140));
      baseFogColor.setHex(0x131d33);
      sun.color.setHex(0x9ab8f5);
      hemi.color.setHex(0x3a5280);
      hemi.groundColor.setHex(0x151822);
      todBaseSun = 0.52;
      todBaseHemi = 0.34;
      todDarkness = 0.96;
      main.environmentIntensity = 0.36;
      renderer.toneMappingExposure = 1.02;
      skyUpdate = {
        zenith: 0x040812,
        midSky: 0x0a142b,
        horizon: 0x162544,
        fogColor: 0x131d33,
        sunColor: 0x9ab8f5,
        sunDir,
        moonDir: sunDir,
        nightMix: 1.0,
        sunsetMix: 0,
        cloudCover: 0.36,
      };
    } else {
      // dawn
      sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 14), THREE.MathUtils.degToRad(86));
      baseFogColor.setHex(0xd6c0b0);
      sun.color.setHex(0xffd2a6);
      hemi.color.setHex(0xa8bfd8);
      hemi.groundColor.setHex(0x4a423a);
      todBaseSun = 1.75;
      todBaseHemi = 0.6;
      todDarkness = 0.35;
      main.environmentIntensity = 0.62;
      renderer.toneMappingExposure = 0.96;
      skyUpdate = {
        zenith: 0x203f6d,
        midSky: 0x6f8fb8,
        horizon: 0xf1c29b,
        fogColor: 0xd6c0b0,
        sunColor: 0xffc894,
        sunDir,
        moonDir: new THREE.Vector3(-0.6, 0.42, 0.5).normalize(),
        nightMix: 0.16,
        sunsetMix: 0.72,
        cloudCover: 0.4,
      };
    }
    mainSky.setState(skyUpdate);
    iblSky.setState(skyUpdate);
    sunFar.color.copy(sun.color);
    waterSkyHorizon.set(skyUpdate.horizon ?? 0xb7d7eb);
    waterSkyZenith.set(skyUpdate.zenith ?? 0x1a539c);
    waterNightMix = skyUpdate.nightMix ?? 0;
    rebuildSkyAndIBL(mode, lastIblOvercastBucket);
    syncCityNightGlow(todDarkness);
    lastCityGlowDarkness = todDarkness;
    lastSkyOvercast = -1;
  };

  const cruiserPosTmp = new THREE.Vector3();
  let lastCityGlowDarkness = -1;
  let lastSkyOvercast = -1;
  let lastFogR = -1;
  let lastFogG = -1;
  let lastFogB = -1;

  const updateWeatherFx = (
    dt: number,
    camPos: THREE.Vector3,
    _camera: THREE.Camera,
    speed: number,
    vehPos?: THREE.Vector3,
    vehYaw?: number,
    vehWidth?: number,
    vehLength?: number,
    wheelSlip = 0,
    surfaceKind: TireSurfaceKind = "asphalt",
  ) => {
    weatherElapsed += dt;
    // Slight temperature gradient: northern foothills cooler (more snow), coast milder
    const temp = camPos.z < -600 ? 0.22 : 0.42;
    stepWeather(weather, dt, temp);
    precipitation.update(dt, camPos, speed, weather, weatherElapsed);
    engine.roads.setWeatherSurface(weather.wet, weather.snowCover, weatherElapsed);
    setTerrainWeather(terrainMesh, weather.wet, weather.snowCover);

    if (vehPos && vehYaw !== undefined && vehWidth && vehLength) {
      spray.emitForVehicle(
        dt,
        vehPos,
        vehYaw,
        vehWidth,
        vehLength,
        speed,
        weather.wet,
        weather.snowCover,
        1.0,
        wheelSlip,
        surfaceKind,
      );
    }
    if (weather.wet > 0.04 || weather.snowCover > 0.04) {
      let trafficSprayCount = 0;
      for (let i = 0; i < vehicles.vehicles.length && trafficSprayCount < 4; i++) {
        const v = vehicles.vehicles[i];
        if (v === vehicles.activeVehicle || v.disabled || Math.abs(v.speed) < 4.5) continue;
        const dx = v.pos.x - camPos.x;
        const dz = v.pos.z - camPos.z;
        if (dx * dx + dz * dz < 88 * 88) {
          spray.emitForVehicle(dt, v.pos, v.yaw, v.width, v.length, v.speed, weather.wet, weather.snowCover, 0.55);
          trafficSprayCount++;
        }
      }
      for (let i = 0; i < wanted.cruisers.length && trafficSprayCount < 6; i++) {
        const c = wanted.cruisers[i];
        if (Math.abs(c.speed) < 4.5) continue;
        const dx = c.x - camPos.x;
        const dz = c.z - camPos.z;
        if (dx * dx + dz * dz < 88 * 88) {
          cruiserPosTmp.set(c.x, c.y, c.z);
          spray.emitForVehicle(dt, cruiserPosTmp, c.yaw, 1.95, 4.7, c.speed, weather.wet, weather.snowCover, 0.55);
          trafficSprayCount++;
        }
      }
    }
    spray.step(dt);
    vehicles.setWeatherSurface(weather.wet, weather.snowCover);

    // Subtle atmospheric fog, overcast sky & sun attenuation for rain / snow + time of day
    const storm = Math.max(weather.rain, weather.snow);
    const fog = main.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color
        .copy(baseFogColor)
        .lerp(stormFogColor, Math.min(1, weather.rain * 1.35))
        .lerp(snowFogColor, Math.min(1, weather.snow * 1.35));
      fog.density = (currentTimeOfDay === "night" ? 0.00048 : 0.00038) + weather.rain * 0.0022 + weather.snow * 0.0032;
      const overcast = Math.min(1, storm * 1.15);
      if (
        Math.abs(overcast - lastSkyOvercast) > 0.005 ||
        Math.abs(fog.color.r - lastFogR) > 0.004 ||
        Math.abs(fog.color.g - lastFogG) > 0.004 ||
        Math.abs(fog.color.b - lastFogB) > 0.004
      ) {
        lastSkyOvercast = overcast;
        lastFogR = fog.color.r;
        lastFogG = fog.color.g;
        lastFogB = fog.color.b;
        mainSky.setState({ overcast, fogColor: fog.color });
        const ovBucket = Math.round(overcast * 4); // 5 quantized storm IBL steps (0..4)
        if (ovBucket !== lastIblOvercastBucket) {
          lastIblOvercastBucket = ovBucket;
          iblSky.setState({ overcast, fogColor: fog.color });
          rebuildSkyAndIBL(currentTimeOfDay, ovBucket);
        }
      }
    }
    const sunTotal = todBaseSun * (1 - storm * 0.55);
    sun.intensity = sunTotal * 0.74;
    sunFar.intensity = sunTotal * 0.26;
    hemi.intensity = todBaseHemi + weather.snow * 0.2 - weather.rain * 0.1;
    const targetDarkness = Math.min(1, Math.max(todDarkness, storm * 0.55));
    if (Math.abs(targetDarkness - lastCityGlowDarkness) > 0.006) {
      lastCityGlowDarkness = targetDarkness;
      syncCityNightGlow(targetDarkness);
    }
  };

  const shadowTexel = (sc.right - sc.left) / 2048;
  const shadowFarTexel = (scFar.right - scFar.left) / 2048;
  const snappedFocus = new THREE.Vector3();
  const snappedFarFocus = new THREE.Vector3();
  const update = (dt: number, focus: THREE.Vector3) => {
    snappedFocus.set(
      Math.round(focus.x / shadowTexel) * shadowTexel,
      Math.round(focus.y / shadowTexel) * shadowTexel,
      Math.round(focus.z / shadowTexel) * shadowTexel,
    );
    sun.position.copy(snappedFocus).addScaledVector(sunDir, 150);
    sun.target.position.copy(snappedFocus);
    sun.target.updateMatrixWorld();
    snappedFarFocus.set(
      Math.round(focus.x / shadowFarTexel) * shadowFarTexel,
      Math.round(focus.y / shadowFarTexel) * shadowFarTexel,
      Math.round(focus.z / shadowFarTexel) * shadowFarTexel,
    );
    sunFar.position.copy(snappedFarFocus).addScaledVector(sunDir, 240);
    sunFar.target.position.copy(snappedFarFocus);
    sunFar.target.updateMatrixWorld();
    mainSky.update(dt, focus);
    water.update(dt, sunDir, waterSkyHorizon, waterSkyZenith, waterNightMix);
    grass.update(dt, weather.snowCover);

    // Update real-time night illumination (active car headlights + 6 nearest streetlights)
    const nightDarkness = lastCityGlowDarkness > 0 ? lastCityGlowDarkness : todDarkness;
    const activeVeh = vehicles.activeVehicle;
    if (activeVeh && !activeVeh.disabled && nightDarkness > 0.08) {
      const fx = Math.sin(activeVeh.yaw);
      const fz = Math.cos(activeVeh.yaw);
      const rx = Math.cos(activeVeh.yaw);
      const rz = -Math.sin(activeVeh.yaw);
      const nose = activeVeh.length * 0.44;
      const track = activeVeh.width * 0.34;
      const hlInt = THREE.MathUtils.smoothstep(nightDarkness, 0.08, 0.65) * 32;
      headlightL.intensity = hlInt;
      headlightR.intensity = hlInt;
      headlightL.position.set(activeVeh.pos.x + fx * nose - rx * track, activeVeh.pos.y + 0.72, activeVeh.pos.z + fz * nose - rz * track);
      headlightR.position.set(activeVeh.pos.x + fx * nose + rx * track, activeVeh.pos.y + 0.72, activeVeh.pos.z + fz * nose + rz * track);
      headlightL.target.position.set(activeVeh.pos.x + fx * 22 - rx * (track * 0.6), activeVeh.pos.y + 0.15, activeVeh.pos.z + fz * 22 - rz * (track * 0.6));
      headlightR.target.position.set(activeVeh.pos.x + fx * 22 + rx * (track * 0.6), activeVeh.pos.y + 0.15, activeVeh.pos.z + fz * 22 + rz * (track * 0.6));
      headlightL.target.updateMatrixWorld();
      headlightR.target.updateMatrixWorld();
    } else {
      headlightL.intensity = 0;
      headlightR.intensity = 0;
    }
    const lampStrength = THREE.MathUtils.smoothstep(nightDarkness, 0.15, 0.75) * 18;
    if (lampStrength > 0.1 && streetlightPoints.length > 0) {
      const ldx = focus.x - lastLampFocusX;
      const ldz = focus.z - lastLampFocusZ;
      if (ldx * ldx + ldz * ldz > 16) {
        lastLampFocusX = focus.x;
        lastLampFocusZ = focus.z;
        bestLampIdx.fill(-1);
        bestLampD2.fill(56 * 56);
        for (let i = 0; i < streetlightPoints.length; i++) {
          const lp = streetlightPoints[i];
          const dx = lp.x - focus.x;
          const dz = lp.z - focus.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= bestLampD2[5]) continue;
          let slot = 5;
          while (slot > 0 && d2 < bestLampD2[slot - 1]) {
            bestLampD2[slot] = bestLampD2[slot - 1];
            bestLampIdx[slot] = bestLampIdx[slot - 1];
            slot--;
          }
          bestLampD2[slot] = d2;
          bestLampIdx[slot] = i;
        }
        for (let k = 0; k < 6; k++) {
          const idx = bestLampIdx[k];
          if (idx >= 0) {
            const lp = streetlightPoints[idx];
            streetLampPool[k].position.set(lp.x, lp.y, lp.z);
          }
        }
      }
      for (let k = 0; k < 6; k++) {
        streetLampPool[k].intensity = bestLampIdx[k] >= 0 ? lampStrength : 0;
      }
    } else {
      for (let k = 0; k < 6; k++) streetLampPool[k].intensity = 0;
    }
    engine.update(focus);
    signals.update(dt);
    livingWorld.update(dt, focus);
    wildlife.update(dt, focus);
    shops.update(dt, focus);
    pedestrians.update(dt, focus, vehicles.getPedVehicleQueries(focus));
    updateSafehouseGarageDoor(dt, focus, vehicles.activeVehicle?.pos ?? null);
    for (let i = 0; i < embeddedCompounds.length; i++) {
      const { site, comp } = embeddedCompounds[i];
      const dx = focus.x - site.x;
      const dz = focus.z - site.z;
      const vis = dx * dx + dz * dz < 360 * 360;
      comp.root.visible = vis;
      if (vis) comp.update(dt);
    }
  };

  return {
    colliders: [terrainMesh, ...landmarkColliders],
    targets: [],
    sun,
    sunDir,
    update,
    hitTarget: () => {},
    aabbs: [],
    destroyables: [],
    groundHeightAt: (x: number, z: number, y: number) => engine.groundHeightAt(x, z, y),
    spatial: engine.spatialAABBs,
    spatialColliders: engine.spatialColliders,
    heightSystem: engine.heightSystem,
    openWorld: engine,
    vehicles,
    activities,
    apartments,
    signals,
    pedestrians,
    livingWorld,
    wildlife,
    wanted,
    shops,
    randomEvents,
    aircraft,
    boats,
    collectibles,
    bodyCarry,
    contracts,
    fightPit,
    compoundDestroyables,
    minimapData,
    getDistrictAt,
    weather,
    setWeatherMode: (mode: WeatherMode) => {
      weather.mode = mode;
      weather.timer = 0;
      if (mode === "rain") {
        weather.snow = 0;
        weather.snowCover = 0;
        weather.rain = Math.max(weather.rain, 0.62);
        weather.wet = Math.max(weather.wet, 0.58);
      } else if (mode === "snow") {
        weather.rain = 0;
        weather.wet = 0;
        weather.snow = Math.max(weather.snow, 0.68);
        weather.snowCover = Math.max(weather.snowCover, 0.62);
      } else if (mode === "clear") {
        weather.rain = 0;
        weather.snow = 0;
        weather.wet = 0;
        weather.snowCover = 0;
      }
      engine.roads.setWeatherSurface(weather.wet, weather.snowCover, weatherElapsed);
      setTerrainWeather(terrainMesh, weather.wet, weather.snowCover);
    },
    getWeatherLabel: () => weatherLabel(weather),
    getWeatherGrip: () => weatherGrip(weather),
    get timeOfDay() {
      return currentTimeOfDay;
    },
    setTimeOfDay: applyTimeOfDay,
    getTimeOfDayDarkness: () => todDarkness,
    updateWeatherFx,
    disposeExtra: () => {
      resetSafehouseGarageDoorState();
      grass.dispose();
      precipitation.dispose();
      spray.dispose();
      mainSky.dispose();
      iblSky.dispose();
      cubeRT.dispose();
      for (const rt of envCache.values()) rt.dispose?.();
      envCache.clear();
      pmrem.dispose();
    },
  };
}
