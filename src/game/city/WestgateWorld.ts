import * as THREE from "three";
import type { LevelResult } from "../levels";
import { OpenWorldEngine } from "./OpenWorldEngine";
import { buildWestgateTerrainFn, buildWestgateTerrainMesh, getDistrictAt, setTerrainWeather } from "./WestgateTerrain";
import { buildWestgateRoadLandmarks, populateWestgateRoads, setBridgeLandmarkDarkness } from "./WestgateRoads";
import { buildWestgateWater } from "./WestgateWater";
import { createRealisticSky, type RealisticSkyState } from "./RealisticSky";
import { CityChunkDispatcher, setCityLightingDarkness } from "./CityBuildingKit";
import { registerDowntownDistrict } from "./DowntownDistrict";
import { registerMidtownDistrict } from "./MidtownDistrict";
import { SAFEHOUSE_SPAWN } from "./SafehouseResidence";
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
import { AirVehicleSystem } from "../vehicles/air/AirVehicleSystem";
import { BoatSystem } from "../vehicles/water/BoatSystem";
import { buildWestgateApartments, type ApartmentSystem } from "./Apartments";
import { loadSave } from "../progression";
import {
  createWeatherState,
  stepWeather,
  weatherGrip,
  weatherLabel,
  type WeatherMode,
  type WeatherState,
} from "../vehicles/weather";
import { Precipitation } from "../vehicles/Precipitation";
import { RoadSpray } from "../vehicles/RoadSpray";

export interface WestgateTeleportSpot {
  id: string;
  label: string;
  x: number;
  z: number;
  yawDeg: number;
}

export const WESTGATE_SPAWN: [number, number, number] = SAFEHOUSE_SPAWN;

export const WESTGATE_TELEPORTS: WestgateTeleportSpot[] = [
  { id: "safehouse", label: "Player Safehouse (420 Crescent)", x: SAFEHOUSE_SPAWN[0], z: SAFEHOUSE_SPAWN[1], yawDeg: SAFEHOUSE_SPAWN[2] },
  { id: "downtown", label: "Downtown Civic Roundabout", x: 24, z: -82, yawDeg: -22 },
  { id: "legion_square", label: "Legion Square & Skyline", x: 38, z: -165, yawDeg: -65 },
  { id: "city_hall", label: "City Hall & Reserve Bank", x: 112, z: -162, yawDeg: 90 },
  { id: "parking_deck", label: "Police HQ & Parking Deck", x: 196, z: 48, yawDeg: 95 },
  { id: "midtown_mall", label: "Midtown Grand Mall", x: -402, z: -86, yawDeg: 0 },
  { id: "medical_center", label: "St. Jude's Medical Center", x: -146, z: -206, yawDeg: 180 },
  { id: "university", label: "Westgate University Campus", x: -165, z: -332, yawDeg: 180 },
  { id: "mirror_park", label: "Mirror Central Park", x: -115, z: 342, yawDeg: 0 },
  { id: "old_townhouses", label: "Old Quarter & Suburbs", x: -240, z: 295, yawDeg: 120 },
  { id: "arch_bridge", label: "Downtown Arch Bridge", x: 385, z: -56, yawDeg: 85 },
  { id: "bay_bridge", label: "Westgate Bay Bridge", x: 350, z: 595, yawDeg: 72 },
  { id: "midtown_skyway", label: "Midtown Skyway & Roundabout", x: -292, z: -140, yawDeg: 90 },
  { id: "west_coast", label: "West Coast & Canals", x: -670, z: -110, yawDeg: -105 },
  { id: "del_sol_pier", label: "Del Sol Pier & Ferris Wheel", x: -706, z: 40, yawDeg: -90 },
  { id: "venice_canals", label: "Venice Canals Footbridges", x: -648, z: 164, yawDeg: 0 },
  { id: "north_canyon", label: "North Gorge Truss Bridge", x: 265, z: -635, yawDeg: 86 },
  { id: "observatory", label: "Observatory Foothills Summit", x: -120, z: -974, yawDeg: 180 },
  { id: "vinewood_crest", label: "Vinewood Crest Estates", x: -220, z: -820, yawDeg: 170 },
  { id: "east_industrial", label: "East Industrial Bascule Bridge", x: 370, z: 268, yawDeg: 86 },
  { id: "seaport_docks", label: "Seaport Container Terminal", x: 635, z: 432, yawDeg: 0 },
  { id: "sports_arena", label: "Westgate Sports Arena", x: -415, z: 615, yawDeg: 0 },
  { id: "south_airport", label: "South Airport Terminal Loop", x: -120, z: 850, yawDeg: 0 },
];

export type TimeOfDayMode = "afternoon" | "sunset" | "night" | "dawn";
export const TIME_OF_DAY_MODES: TimeOfDayMode[] = ["afternoon", "sunset", "night", "dawn"];
export const TIME_OF_DAY_LABELS: Record<TimeOfDayMode, string> = {
  afternoon: "Afternoon",
  sunset: "Sunset",
  night: "Night",
  dawn: "Dawn",
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

  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 10000, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCache = new Map<TimeOfDayMode, THREE.WebGLRenderTarget>();
  const rebuildSkyAndIBL = (mode: TimeOfDayMode) => {
    const cached = envCache.get(mode);
    if (cached) {
      main.environment = cached.texture;
      cubeCam.update(renderer, skyScene);
      main.background = cubeRT.texture;
      return;
    }
    cubeCam.update(renderer, skyScene);
    main.background = cubeRT.texture;
    const rt = pmrem.fromCubemap(cubeRT.texture);
    envCache.set(mode, rt);
    main.environment = rt.texture;
  };
  rebuildSkyAndIBL("afternoon");
  main.environmentIntensity = 0.78;
  main.fog = new THREE.FogExp2(0xadd0e8, 0.00038);
  renderer.toneMappingExposure = 0.96;

  // 2. Directional sun (texel-snapped high-res shadow frustum centered on player) + coastal sky hemi
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  const sc = sun.shadow.camera;
  sc.left = -46;
  sc.right = 46;
  sc.top = 46;
  sc.bottom = -46;
  sc.near = 5;
  sc.far = 340;
  sun.shadow.bias = -0.00028;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.0;
  content.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0x9bc8ef, 0x564e3e, 0.68);
  content.add(hemi);

  // 3. OpenWorldEngine + District Chunk Dispatcher + 4-Tier Curved Road Skeleton
  const dispatcher = new CityChunkDispatcher();
  let terrainAt: (x: number, z: number) => number = () => 4.5;
  const engine = new OpenWorldEngine({
    chunkBuilder: (chunk) => dispatcher.buildChunk(chunk, terrainAt, engine.roads),
    chunkOptions: {
      nearRadius: 280,
      lodRadius: 960,
      hysteresis: 28,
      maxBuildsPerFrame: 3,
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

  const terrainMesh = buildWestgateTerrainMesh(terrainAt, 2400, 160);
  content.add(terrainMesh);
  engine.spatialColliders.addGlobal(terrainMesh);
  terrainMesh.updateMatrix();
  terrainMesh.matrixAutoUpdate = false;

  // 5. Animated Ocean / River / Harbor / Canal Water
  const water = buildWestgateWater(terrainAt, sunDir, 2400, 160);
  water.mesh.updateMatrix();
  water.mesh.matrixAutoUpdate = false;
  content.add(water.mesh);

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
  populateWestgateProps(engine.props, engine.roads, terrainAt, WESTGATE_TELEPORTS);

  // 8. Finalize roads, bridge WalkableSurfaces, props, and prewarm spawn chunks
  engine.finalizeStaticWorld(WESTGATE_SPAWN[0], WESTGATE_SPAWN[1]);
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
  const initialSave = loadSave();
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
    rebuildSkyAndIBL(mode);
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
  ) => {
    weatherElapsed += dt;
    // Slight temperature gradient: northern foothills cooler (more snow), coast milder
    const temp = camPos.z < -600 ? 0.22 : 0.42;
    stepWeather(weather, dt, temp);
    precipitation.update(dt, camPos, speed, weather, weatherElapsed);
    engine.roads.setWeatherSurface(weather.wet, weather.snowCover, weatherElapsed);
    setTerrainWeather(terrainMesh, weather.wet, weather.snowCover);

    if (vehPos && vehYaw !== undefined && vehWidth && vehLength) {
      spray.emitForVehicle(dt, vehPos, vehYaw, vehWidth, vehLength, speed, weather.wet, weather.snowCover, 1.0);
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
      }
    }
    sun.intensity = todBaseSun * (1 - storm * 0.55);
    hemi.intensity = todBaseHemi + weather.snow * 0.2 - weather.rain * 0.1;
    const targetDarkness = Math.min(1, Math.max(todDarkness, storm * 0.55));
    if (Math.abs(targetDarkness - lastCityGlowDarkness) > 0.006) {
      lastCityGlowDarkness = targetDarkness;
      syncCityNightGlow(targetDarkness);
    }
  };

  const shadowTexel = (sc.right - sc.left) / 1536;
  const snappedFocus = new THREE.Vector3();
  const update = (dt: number, focus: THREE.Vector3) => {
    snappedFocus.set(
      Math.round(focus.x / shadowTexel) * shadowTexel,
      Math.round(focus.y / shadowTexel) * shadowTexel,
      Math.round(focus.z / shadowTexel) * shadowTexel,
    );
    sun.position.copy(snappedFocus).addScaledVector(sunDir, 150);
    sun.target.position.copy(snappedFocus);
    sun.target.updateMatrixWorld();
    mainSky.update(dt, focus);
    water.update(dt);
    engine.update(focus);
    signals.update(dt);
    livingWorld.update(dt, focus);
    wildlife.update(dt, focus);
    shops.update(dt, focus);
    pedestrians.update(dt, focus, vehicles.getPedVehicleQueries(focus));
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
