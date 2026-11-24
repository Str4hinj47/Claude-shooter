import * as THREE from "three";
import type { LevelResult } from "../levels";
import { OpenWorldEngine } from "./OpenWorldEngine";
import { buildWestgateTerrainFn, buildWestgateTerrainMesh, getDistrictAt } from "./WestgateTerrain";
import { buildWestgateRoadLandmarks, populateWestgateRoads } from "./WestgateRoads";
import { buildWestgateWater } from "./WestgateWater";
import { CityChunkDispatcher } from "./CityBuildingKit";
import { registerDowntownDistrict } from "./DowntownDistrict";
import { registerMidtownDistrict } from "./MidtownDistrict";
import { registerOldQuarterDistrict } from "./OldQuarterDistrict";
import { registerWestCoastDistrict } from "./WestCoastDistrict";
import { registerFoothillsDistrict } from "./FoothillsDistrict";
import { registerPortAirportDistrict } from "./PortAirportDistrict";
import { populateWestgateProps } from "./WestgateProps";
import { WestgateVehicleManager } from "./VehicleSystem";
import { buildMinimapData, type MinimapData } from "./MinimapData";
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

export const WESTGATE_SPAWN: [number, number, number] = [24, -82, -25];

export const WESTGATE_TELEPORTS: WestgateTeleportSpot[] = [
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

export interface WestgateLevelResult extends LevelResult {
  openWorld: OpenWorldEngine;
  vehicles: WestgateVehicleManager;
  minimapData: MinimapData;
  getDistrictAt: typeof getDistrictAt;
  weather: WeatherState;
  setWeatherMode: (mode: WeatherMode) => void;
  getWeatherLabel: () => string;
  getWeatherGrip: () => number;
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

function buildCoastalDaySky(sunDir: THREE.Vector3): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color(0x1f5ca6) },
        uMidSky: { value: new THREE.Color(0x4c93d4) },
        uHorizon: { value: new THREE.Color(0xadd0e8) },
        uSunDir: { value: sunDir.clone().normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uMidSky;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uMidSky, smoothstep(0.0, 0.24, h));
          col = mix(col, uZenith, smoothstep(0.20, 0.85, h));
          float sunDot = max(0.0, dot(d, uSunDir));
          // Warm Mie atmospheric scatter & crisp bounded sun disk (bloom-safe)
          col += vec3(1.0, 0.88, 0.68) * (pow(sunDot, 12.0) * 0.22 + pow(sunDot, 220.0) * 0.65);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
}

export function buildWestgateWorld(
  content: THREE.Object3D,
  main: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): WestgateLevelResult {
  // 1. California coastal golden-afternoon sky & IBL
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - 42),
    THREE.MathUtils.degToRad(215),
  );
  const skyScene = new THREE.Scene();
  skyScene.add(buildCoastalDaySky(sunDir));

  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 10000, cubeRT);
  cubeCam.update(renderer, skyScene);
  main.background = cubeRT.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  main.environment = pmrem.fromCubemap(cubeRT.texture).texture;
  pmrem.dispose();
  main.environmentIntensity = 0.45;
  main.fog = new THREE.FogExp2(0xadd0e8, 0.00038);
  renderer.toneMappingExposure = 0.92;

  // 2. Directional sun (moving shadow frustum centered on player) + coastal sky hemi
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -95;
  sc.right = 95;
  sc.top = 95;
  sc.bottom = -95;
  sc.near = 5;
  sc.far = 360;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2.5;
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
      lodRadius: 1150,
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
  registerOldQuarterDistrict(dispatcher, engine.roads);
  registerWestCoastDistrict(dispatcher, engine.roads, engine.heightSystem);
  registerFoothillsDistrict(dispatcher, engine.roads, engine.heightSystem);
  registerPortAirportDistrict(dispatcher, engine.roads);

  const terrainMesh = buildWestgateTerrainMesh(terrainAt, 2400, 160);
  content.add(terrainMesh);
  engine.spatialColliders.addGlobal(terrainMesh);

  // 5. Animated Ocean / River / Harbor / Canal Water
  const water = buildWestgateWater(terrainAt, sunDir, 2400, 160);
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
  }

  // 7. Populate citywide instanced trees, streetlights, signals, hydrants & parked cars (Phase 8)
  populateWestgateProps(engine.props, engine.roads, terrainAt, WESTGATE_TELEPORTS);

  // 8. Finalize roads, bridge WalkableSurfaces, props, and prewarm spawn chunks
  engine.finalizeStaticWorld(WESTGATE_SPAWN[0], WESTGATE_SPAWN[1]);
  content.add(engine.root);

  // 9. Spawn driveable Overtake car fleet & ambient NPC road traffic
  const vehicles = new WestgateVehicleManager(engine);
  content.add(vehicles.root);
  const minimapData = buildMinimapData(engine.roads);

  // 10. Rain & snow precipitation + tire road spray
  const weather = createWeatherState("auto");
  const precipitation = new Precipitation(main);
  const spray = new RoadSpray(main);
  const baseFogColor = new THREE.Color(0xadd0e8);
  const stormFogColor = new THREE.Color(0x6b7c8e);
  const snowFogColor = new THREE.Color(0xcbd6e2);
  const bgWeatherColor = new THREE.Color();
  let weatherElapsed = 0;

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

    if (vehPos && vehYaw !== undefined && vehWidth && vehLength) {
      spray.update(dt, vehPos, vehYaw, vehWidth, vehLength, speed, weather.wet, weather.snowCover);
    } else {
      spray.update(dt, camPos, 0, 1.8, 4.2, 0, 0, 0);
    }

    // Subtle atmospheric fog, overcast sky & sun attenuation for rain / snow
    const storm = Math.max(weather.rain, weather.snow);
    const fog = main.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color
        .copy(baseFogColor)
        .lerp(stormFogColor, Math.min(1, weather.rain * 1.35))
        .lerp(snowFogColor, Math.min(1, weather.snow * 1.35));
      fog.density = 0.00038 + weather.rain * 0.0022 + weather.snow * 0.0032;
    }
    if (storm > 0.12 && fog) {
      bgWeatherColor.copy(fog.color).multiplyScalar(weather.rain > weather.snow ? 0.8 : 0.96);
      main.background = bgWeatherColor;
    } else {
      main.background = cubeRT.texture;
    }
    sun.intensity = 2.25 * (1 - storm * 0.55);
    hemi.intensity = 0.68 + weather.snow * 0.25 - weather.rain * 0.12;
  };

  const update = (dt: number, focus: THREE.Vector3) => {
    sun.position.copy(focus).addScaledVector(sunDir, 150);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();
    water.update(dt);
    engine.update(focus);
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
    minimapData,
    getDistrictAt,
    weather,
    setWeatherMode: (mode: WeatherMode) => {
      weather.mode = mode;
      weather.timer = 0;
      if (mode === "rain") {
        weather.snow = 0;
        weather.rain = Math.max(weather.rain, 0.52);
        weather.wet = Math.max(weather.wet, 0.36);
      } else if (mode === "snow") {
        weather.rain = 0;
        weather.snow = Math.max(weather.snow, 0.52);
        weather.snowCover = Math.max(weather.snowCover, 0.25);
      } else if (mode === "clear") {
        weather.rain = 0;
        weather.snow = 0;
      }
    },
    getWeatherLabel: () => weatherLabel(weather),
    getWeatherGrip: () => weatherGrip(weather),
    updateWeatherFx,
    disposeExtra: () => {
      precipitation.dispose();
      spray.dispose();
    },
  };
}
