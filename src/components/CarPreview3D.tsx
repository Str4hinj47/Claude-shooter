import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CarId } from "../game/vehicles/catalog";
import { ModelLibrary } from "../game/vehicles/ModelLibrary";
import type { CarCustomConfig } from "../game/progression";

interface CarPreview3DProps {
  carId: CarId;
  paintHex?: string;
  custom?: Partial<CarCustomConfig>;
  className?: string;
  label?: string;
}

let sharedModelLib: ModelLibrary | null = null;
function getPreviewLib(): ModelLibrary {
  if (!sharedModelLib) sharedModelLib = new ModelLibrary();
  return sharedModelLib;
}

function parseHexColor(hex?: string): number | undefined {
  if (!hex) return undefined;
  const clean = hex.trim().replace(/^#/, "");
  const parsed = Number.parseInt(clean, 16);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Interactive live 3D vehicle showroom turntable preview using the real game GLB models,
 * studio RoomEnvironment reflections, and custom paint/finish/mod support.
 */
export function CarPreview3D({ carId, paintHex, custom, className = "", label }: CarPreview3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const stateRef = useRef({
    yaw: 0.68,
    pitch: 0.24,
    dist: 4.9,
    dragging: false,
    lastX: 0,
    lastY: 0,
    idleTime: 0,
  });

  const sceneRefs = useRef<{
    scene: THREE.Scene;
    carSlot: THREE.Group;
    pedestal: THREE.Group;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
  } | null>(null);

  // Initialize WebGL showroom stage once
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.background = new THREE.Color(0x070a10);

    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 60);

    // Studio key, cool fill, and rim lighting
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x161b26, 0.65);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff5e8, 2.4);
    key.position.set(4.5, 6.2, 4.0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    const d = 3.6;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0005;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x38bdf8, 1.35);
    rim.position.set(-4.8, 3.2, -4.5);
    scene.add(rim);

    const fill = new THREE.DirectionalLight(0x93c5fd, 0.72);
    fill.position.set(-4.2, 1.4, 4.4);
    scene.add(fill);

    // Turntable pedestal & glowing edge ring (scales dynamically to vehicle length)
    const pedestal = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(2.85, 3.05, 0.14, 64),
      new THREE.MeshStandardMaterial({ color: 0x0e141f, metalness: 0.55, roughness: 0.32 }),
    );
    floor.position.y = -0.07;
    floor.receiveShadow = true;
    pedestal.add(floor);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.74, 2.81, 64),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.003;
    pedestal.add(ring);
    scene.add(pedestal);

    const outerGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ color: 0x06090f, metalness: 0.25, roughness: 0.72 }),
    );
    outerGlow.rotation.x = -Math.PI / 2;
    outerGlow.position.y = -0.14;
    scene.add(outerGlow);

    const carSlot = new THREE.Group();
    scene.add(carSlot);
    sceneRefs.current = { scene, carSlot, pedestal, renderer, camera };

    const syncSize = () => {
      const w = Math.max(120, container.clientWidth);
      const h = Math.max(120, container.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(container);

    let raf = 0;
    let lastT = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      const st = stateRef.current;
      if (!st.dragging) {
        st.idleTime += dt;
        if (st.idleTime > 0.6) st.yaw += dt * 0.36;
      }

      const cosP = Math.cos(st.pitch);
      camera.position.set(
        Math.sin(st.yaw) * cosP * st.dist,
        0.58 + Math.sin(st.pitch) * st.dist,
        Math.cos(st.yaw) * cosP * st.dist,
      );
      camera.lookAt(0, 0.56, 0);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      sceneRefs.current = null;
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Load & instantiate selected vehicle whenever carId / paint / custom changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const lib = getPreviewLib();
    const customPayload: Partial<CarCustomConfig> | undefined = custom
      ? { ...custom, paintHex: paintHex ?? custom.paintHex }
      : paintHex
        ? { paintHex }
        : undefined;

    lib.loadModel(carId).then((model) => {
      if (cancelled || !sceneRefs.current) return;
      const { carSlot } = sceneRefs.current;
      while (carSlot.children.length > 0) {
        carSlot.remove(carSlot.children[0]);
      }
      if (model) {
        const carGroup = lib.create(carId, {
          paint: parseHexColor(paintHex ?? custom?.paintHex),
          player: true,
          custom: customPayload,
        });
        if (carGroup) {
          // Center visually on turntable & frame distance + pedestal to vehicle length
          const span = Math.max(3.6, model.length);
          const pedScale = Math.max(0.95, span / 4.75);
          sceneRefs.current.pedestal.scale.set(pedScale, 1, pedScale);
          stateRef.current.dist = clampDist(span * 1.12);
          // Subtle showroom DRL headlights & ruby taillights glow
          const hlMats = carGroup.userData.headlightMaterials as THREE.MeshStandardMaterial[] | undefined;
          if (hlMats) for (const m of hlMats) m.emissiveIntensity = 1.05;
          const tlMats = carGroup.userData.brakeMaterials as THREE.MeshStandardMaterial[] | undefined;
          if (tlMats) for (const m of tlMats) m.emissiveIntensity = 0.75;
          carSlot.add(carGroup);
        }
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [carId, paintHex, custom]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    stateRef.current.dragging = true;
    stateRef.current.lastX = e.clientX;
    stateRef.current.lastY = e.clientY;
    stateRef.current.idleTime = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stateRef.current;
    if (!st.dragging) return;
    const dx = e.clientX - st.lastX;
    const dy = e.clientY - st.lastY;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    st.yaw -= dx * 0.01;
    st.pitch = Math.max(0.06, Math.min(0.85, st.pitch + dy * 0.007));
    st.idleTime = 0;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    stateRef.current.dragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    stateRef.current.dist = clampDist(stateRef.current.dist + e.deltaY * 0.0025);
  };

  return (
    <div
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      className={`relative cursor-grab select-none overflow-hidden border border-white/12 bg-[#070a10] active:cursor-grabbing ${className}`}
    >
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#070a10]/70 font-mono text-[10px] uppercase tracking-[0.25em] text-[#38bdf8]">
          Loading 3D Vehicle...
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-3 right-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-[#8a909e]">
        <span>{label ?? "SHOWROOM PREVIEW"}</span>
        <span>DRAG TO ROTATE · SCROLL ZOOM</span>
      </div>
    </div>
  );
}

function clampDist(v: number): number {
  return Math.max(3.1, Math.min(7.8, v));
}
