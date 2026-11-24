import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CARS, type CarId } from "../game/vehicles/catalog";
import { ModelLibrary, type CarModel } from "../game/vehicles/ModelLibrary";

/**
 * Standalone car-door viewer: loads the game's car models (ModelLibrary) and
 * lets you swing every door open/closed. No Game, no city, no gameplay.
 */

const DOOR_KEYS = ["fl", "fr", "rl", "rr"] as const;
type DoorKey = (typeof DOOR_KEYS)[number];
const MAX_RAD = (62 * Math.PI) / 180;

interface DoorRig {
  node: THREE.Object3D;
  sign: number; // outward swing direction (same rule as the game)
}

/** Game rule: rotation.y = sign(outX * armZ) * maxRad * amount */
function computeDoorRigs(car: THREE.Object3D): Map<DoorKey, DoorRig> {
  const rigs = new Map<DoorKey, DoorRig>();
  car.updateMatrixWorld(true);
  for (const key of DOOR_KEYS) {
    const node = car.getObjectByName(`door_${key}`);
    if (!node) continue;
    const pivot = node.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) continue;
    const centroid = box.getCenter(new THREE.Vector3());
    const outX = Math.sign(pivot.x) || -1;
    const armZ = centroid.z - pivot.z;
    rigs.set(key, { node, sign: Math.sign(outX * armZ) || -1 });
  }
  return rigs;
}

const ZERO: Record<DoorKey, number> = { fl: 0, fr: 0, rl: 0, rr: 0 };

export default function CarDoorViewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<THREE.Group | null>(null);
  const rigsRef = useRef<Map<DoorKey, DoorRig>>(new Map());
  const targetRef = useRef<Record<DoorKey, number>>({ ...ZERO });

  const [carId, setCarId] = useState<CarId>("golf");
  const [model, setModel] = useState<CarModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<DoorKey[]>([]);
  const [amounts, setAmounts] = useState<Record<DoorKey, number>>({ ...ZERO });
  const [master, setMaster] = useState(0);

  const library = useMemo(() => new ModelLibrary(), []);
  const carIdRef = useRef<CarId>("golf");
  carIdRef.current = carId;
  const degRef = useRef<Record<string, number>>({});

  /* ---------- three.js scene (created once) ---------- */
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d10);
    scene.fog = new THREE.Fog(0x0b0d10, 34, 95);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x1a1d22, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(6, 10, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.75);
    rim.position.set(-7, 4, -6);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(45, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.96, metalness: 0 }),
    );
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(90, 90, 0x2a3038, 0x1c2126);
    grid.position.y = 0.002;
    (grid.material as THREE.Material).opacity = 0.3;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const holder = new THREE.Group();
    scene.add(holder);
    holderRef.current = holder;

    const camera = new THREE.PerspectiveCamera(
      38,
      mount.clientWidth / Math.max(1, mount.clientHeight),
      0.1,
      200,
    );
    camera.position.set(-6.0, 3.0, 7.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 3;
    controls.maxDistance = 28;
    controls.target.set(0, 0.7, 0);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      controls.update();
      const deg = degRef.current;
      for (const k of Object.keys(deg)) delete deg[k];
      for (const [key2, rig] of rigsRef.current) {
        const target = targetRef.current[key2] ?? 0;
        const cur = (rig.node.rotation.y / MAX_RAD) * rig.sign;
        const next = cur + (target - cur) * Math.min(1, dt * 7);
        rig.node.rotation.y = rig.sign * MAX_RAD * next;
        deg[key2] = next * 62;
      }
      // expose live door state (deg) for automated end-to-end checks
      (window as unknown as Record<string, unknown>).__doorState = {
        car: carIdRef.current,
        deg: { ...deg },
      };
      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      holderRef.current = null;
    };
  }, []);

  /* ---------- load the selected model via the game's ModelLibrary ---------- */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    library
      .loadModel(carId)
      .then((m) => {
        if (cancelled) return;
        if (!m) setError(`Failed to load models/${carId}.glb`);
        setModel(m);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [carId, library]);

  /* ---------- mount the loaded car into the scene ---------- */
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !model) return;
    holder.clear();
    const clone = model.scene.clone(true);
    holder.add(clone);
    rigsRef.current = computeDoorRigs(clone);
    setAvailable([...rigsRef.current.keys()]);
    for (const rig of rigsRef.current.values()) rig.node.rotation.y = 0;
  }, [model]);

  /* ---------- publish door targets to the render loop ---------- */
  useEffect(() => {
    targetRef.current = { ...amounts };
  }, [amounts]);

  /* ---------- UI actions ---------- */
  const setAll = (v: number) => {
    setAmounts({ fl: v, fr: v, rl: v, rr: v });
    setMaster(v);
  };
  const toggleDoor = (key: DoorKey) => {
    const next = { ...amounts, [key]: amounts[key] > 0.5 ? 0 : 1 };
    const sum = DOOR_KEYS.reduce((s, k) => s + (rigsRef.current.has(k) ? next[k] : 0), 0);
    setAmounts(next);
    setMaster(rigsRef.current.size ? sum / rigsRef.current.size : 0);
  };

  const car = CARS.find((c) => c.id === carId)!;
  const shown = loading ? "loading model…" : error ?? `${car.maker} ${car.name}`;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0b0d10] text-zinc-200">
      <div ref={mountRef} className="absolute inset-0" />

      {/* car selector */}
      <div className="absolute left-0 top-0 z-10 m-4 w-52 rounded-lg border border-zinc-700/60 bg-zinc-900/80 p-3 backdrop-blur">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-zinc-400">
          Door viewer
        </div>
        <div className="flex flex-col gap-1">
          {CARS.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCarId(c.id);
                setAll(0);
              }}
              className={`rounded px-2.5 py-1.5 text-left text-sm transition ${
                c.id === carId
                  ? "bg-amber-500/90 font-semibold text-black"
                  : "bg-zinc-800/70 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="mt-3 border-t border-zinc-700/60 pt-2 font-mono text-[10px] leading-relaxed text-zinc-500">
          {shown}
          <br />
          drag = orbit · wheel = zoom
          <br />
          <a href="#game" className="text-zinc-400 underline hover:text-amber-400">
            #game loads the full game
          </a>
        </div>
      </div>

      {/* door controls */}
      <div className="absolute bottom-0 left-1/2 z-10 m-4 -translate-x-1/2 rounded-lg border border-zinc-700/60 bg-zinc-900/85 px-5 py-3 backdrop-blur">
        <div className="mb-2 flex items-center justify-center gap-2">
          {DOOR_KEYS.map((key) => {
            const has = available.includes(key);
            const open = amounts[key] > 0.5;
            return (
              <button
                key={key}
                disabled={!has}
                onClick={() => toggleDoor(key)}
                className={`min-w-14 rounded px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition ${
                  !has
                    ? "cursor-default bg-zinc-800/30 text-zinc-600"
                    : open
                      ? "bg-emerald-500/90 font-semibold text-black"
                      : "bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600"
                }`}
              >
                {key.toUpperCase()}
              </button>
            );
          })}
          <div className="mx-2 h-6 w-px bg-zinc-700" />
          <button
            onClick={() => setAll(1)}
            className="rounded bg-amber-500/90 px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-black hover:bg-amber-400"
          >
            Open all
          </button>
          <button
            onClick={() => setAll(0)}
            className="rounded bg-zinc-700/80 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-zinc-200 hover:bg-zinc-600"
          >
            Close
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            swing
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(master * 100)}
            onChange={(e) => setAll(Number(e.target.value) / 100)}
            className="h-1.5 w-72 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-amber-500"
          />
          <span className="w-10 font-mono text-xs text-amber-400">{Math.round(master * 62)}°</span>
        </div>
      </div>
    </div>
  );
}
