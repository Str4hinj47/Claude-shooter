export type GraphicsPresetId = "safe" | "balanced" | "ultra";

export interface GraphicsProfileSpec {
  id: GraphicsPresetId;
  label: string;
  tagline: string;
  maxDpr: number;
  useComposer: boolean;
  useN8ao: boolean;
  smaaPreset: "LOW" | "MEDIUM" | "HIGH";
  shadowsEnabled: boolean;
  nearShadowSize: number;
  farShadowEnabled: boolean;
  farShadowSize: number;
  cubeSize: number;
  nearRadius: number;
  lodRadius: number;
  prewarmRadius: number;
  maxHouseGlbs: boolean;
  maxTrafficModels: number;
  maxAnisotropy: number;
  enableJolt: boolean;
}

export const GRAPHICS_PROFILES: Record<GraphicsPresetId, GraphicsProfileSpec> = {
  safe: {
    id: "safe",
    label: "SAFE / LOW VRAM",
    tagline: "Direct renderer, zero post-FX targets, procedural houses, fast boot — crash-proof on low-RAM GPUs.",
    maxDpr: 1.0,
    useComposer: false,
    useN8ao: false,
    smaaPreset: "LOW",
    shadowsEnabled: false,
    nearShadowSize: 512,
    farShadowEnabled: false,
    farShadowSize: 512,
    cubeSize: 64,
    nearRadius: 180,
    lodRadius: 460,
    prewarmRadius: 220,
    maxHouseGlbs: false,
    maxTrafficModels: 4,
    maxAnisotropy: 2,
    enableJolt: false,
  },
  balanced: {
    id: "balanced",
    label: "BALANCED (RECOMMENDED)",
    tagline: "SMAA + Bloom, 1024px sun shadow, throttled GLB streaming, no heavy AO pass — smooth 60 FPS.",
    maxDpr: 1.25,
    useComposer: true,
    useN8ao: false,
    smaaPreset: "MEDIUM",
    shadowsEnabled: true,
    nearShadowSize: 1024,
    farShadowEnabled: false,
    farShadowSize: 512,
    cubeSize: 64,
    nearRadius: 230,
    lodRadius: 620,
    prewarmRadius: 300,
    maxHouseGlbs: true,
    maxTrafficModels: 8,
    maxAnisotropy: 4,
    enableJolt: true,
  },
  ultra: {
    id: "ultra",
    label: "ULTRA / DEDICATED GPU",
    tagline: "Half-res N8AO contact shadows, dual-cascade 1536px/1024px shadows, full 780m skyline & car fleet.",
    maxDpr: 1.5,
    useComposer: true,
    useN8ao: true,
    smaaPreset: "HIGH",
    shadowsEnabled: true,
    nearShadowSize: 1536,
    farShadowEnabled: true,
    farShadowSize: 1024,
    cubeSize: 128,
    nearRadius: 280,
    lodRadius: 780,
    prewarmRadius: 400,
    maxHouseGlbs: true,
    maxTrafficModels: 13,
    maxAnisotropy: 4,
    enableJolt: true,
  },
};

export interface HardwareProbeResult {
  webgl2: boolean;
  gpuRenderer: string;
  maxTextureSize: number;
  deviceMemoryGb: number | null;
  cores: number;
  recommended: GraphicsPresetId;
  previousBootInterrupted: boolean;
}

const PRESET_KEY = "westgate_launcher_preset_v1";
const BOOT_FLAG_KEY = "westgate_boot_in_progress_v1";

export function loadLauncherPreset(): GraphicsPresetId {
  try {
    const v = localStorage.getItem(PRESET_KEY);
    if (v === "safe" || v === "balanced" || v === "ultra") return v;
  } catch {}
  return "balanced";
}

export function saveLauncherPreset(id: GraphicsPresetId): void {
  try {
    localStorage.setItem(PRESET_KEY, id);
  } catch {}
}

export function getLauncherProfile(): GraphicsProfileSpec {
  return GRAPHICS_PROFILES[loadLauncherPreset()];
}

export function markBootStarted(): void {
  try {
    localStorage.setItem(BOOT_FLAG_KEY, String(Date.now()));
  } catch {}
}

export function markBootSucceeded(): void {
  try {
    localStorage.removeItem(BOOT_FLAG_KEY);
  } catch {}
}

export function wasPreviousBootInterrupted(): boolean {
  try {
    return localStorage.getItem(BOOT_FLAG_KEY) !== null;
  } catch {
    return false;
  }
}

export function probeClientHardware(): HardwareProbeResult {
  const previousBootInterrupted = wasPreviousBootInterrupted();
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const deviceMemoryGb = typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null;
  const cores = typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : 4;

  let webgl2 = false;
  let gpuRenderer = "Unknown GPU";
  let maxTextureSize = 4096;

  if (typeof document !== "undefined") {
    try {
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
      if (gl) {
        webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
        maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          gpuRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "WebGL GPU");
        } else {
          gpuRenderer = String(gl.getParameter(gl.RENDERER) || "WebGL GPU");
        }
        const lose = gl.getExtension("WEBGL_lose_context");
        lose?.loseContext();
      }
    } catch {
      /* ignore probe errors */
    }
  }

  let recommended: GraphicsPresetId = "balanced";
  const isSoftware = /swiftshader|llvmpipe|software|microsoft basic/i.test(gpuRenderer);
  const isDiscrete = /nvidia|geforce|rtx|gtx|radeon rx|arc a\d/i.test(gpuRenderer);
  if (previousBootInterrupted || !webgl2 || isSoftware || (deviceMemoryGb !== null && deviceMemoryGb <= 4) || maxTextureSize <= 4096) {
    recommended = "safe";
  } else if (isDiscrete && (deviceMemoryGb === null || deviceMemoryGb >= 8) && cores >= 6) {
    recommended = "ultra";
  }

  return {
    webgl2,
    gpuRenderer,
    maxTextureSize,
    deviceMemoryGb,
    cores,
    recommended,
    previousBootInterrupted,
  };
}

export const CORE_PRECACHE_ASSETS: string[] = [
  "characters/business.glb",
  "characters/soldier.glb",
  "characters/civilian.glb",
  "characters/fighter/base_body.glb",
  "characters/fighter/clothing_shorts.glb",
  "animations/combat/fight_idle.glb",
  "animations/combat/jab.glb",
  "animations/combat/cross.glb",
  "animations/combat/block.glb",
  "models/golf.glb",
  "models/civic.glb",
  "models/police_cruiser.glb",
];

/**
 * Sequentially warms core binary assets into browser CacheStorage / HTTP cache (2 at a time)
 * so spawning into Westgate Bay never triggers a 50-request download & decode storm.
 */
export async function prewarmCoreAssets(
  onProgress?: (done: number, total: number, currentFile: string) => void,
): Promise<void> {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  const total = CORE_PRECACHE_ASSETS.length;
  let done = 0;

  let cache: Cache | null = null;
  try {
    if ("caches" in window) {
      cache = await window.caches.open("westgate-core-assets-v1");
    }
  } catch {
    cache = null;
  }

  for (let i = 0; i < total; i += 2) {
    const batch = CORE_PRECACHE_ASSETS.slice(i, i + 2);
    await Promise.all(
      batch.map(async (rel) => {
        const url = `${base}${rel}`;
        try {
          if (cache) {
            const hit = await cache.match(url);
            if (!hit) {
              const res = await fetch(url);
              if (res.ok) await cache.put(url, res.clone());
            }
          } else {
            await fetch(url);
          }
        } catch {
          /* best effort */
        } finally {
          done++;
          onProgress?.(done, total, rel);
        }
      }),
    );
  }
}
