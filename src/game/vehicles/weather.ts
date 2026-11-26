export type WeatherMode = "auto" | "clear" | "rain" | "snow";

export const WEATHER_MODES: WeatherMode[] = ["auto", "clear", "rain", "snow"];

export interface WeatherState {
  mode: WeatherMode;
  target: "clear" | "rain" | "snow";
  rain: number;
  snow: number;
  wet: number;
  snowCover: number;
  timer: number;
  elapsed: number;
  wind: number;
}

// Deterministic smooth 2D value noise (zero-dependency equivalent of simplex noise for weather transitions)
function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}

function noise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function createWeatherState(mode: WeatherMode = "auto"): WeatherState {
  return {
    mode,
    target: mode === "rain" || mode === "snow" ? mode : "clear",
    rain: mode === "rain" ? 1 : 0,
    snow: mode === "snow" ? 1 : 0,
    wet: mode === "rain" ? 0.6 : 0,
    snowCover: mode === "snow" ? 0.5 : 0,
    timer: 24,
    elapsed: 0,
    wind: 0,
  };
}

export function dampExp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function autoWeatherTarget(elapsed: number, temperature = 0.45): "clear" | "rain" | "snow" {
  const n = noise2D(elapsed * 0.015, temperature * 3.1);
  if (temperature < 0.28) return n > -0.2 ? "snow" : "clear";
  if (n > 0.25) return "snow";
  if (n > -0.15) return "rain";
  return "clear";
}

export function stepWeather(state: WeatherState, dt: number, temperature = 0.45): WeatherState {
  state.elapsed += dt;
  state.wind = noise2D(state.elapsed * 0.05, 9.2);
  if (state.mode === "auto") {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.target = autoWeatherTarget(state.elapsed, temperature);
      state.timer = 40 + Math.abs(noise2D(state.elapsed * 0.02, 3.3)) * 55;
    }
  } else {
    state.target = state.mode;
  }
  const rainTarget = state.target === "rain" ? 1 : 0;
  const snowTarget = state.target === "snow" ? 1 : 0;
  // Slightly brisker transitions when explicitly toggled, smooth in auto
  const rate = state.mode === "auto" ? 0.18 : 0.75;
  state.rain = dampExp(state.rain, rainTarget, rate, dt);
  state.snow = dampExp(state.snow, snowTarget, rate, dt);
  state.wet = dampExp(
    state.wet,
    state.rain > 0.05 ? Math.max(state.rain, 0.35) : 0,
    state.rain > 0.05 ? 0.35 : 0.08,
    dt,
  );
  state.snowCover = dampExp(
    state.snowCover,
    state.snow > 0.05 ? Math.max(state.snow, 0.35) : 0,
    state.snow > 0.05 ? 0.3 : 0.06,
    dt,
  );
  if (state.rain < 0.001) state.rain = 0;
  if (state.snow < 0.001) state.snow = 0;
  return state;
}

export function weatherGrip(state: WeatherState): number {
  return Math.max(0.58, 1 - state.wet * 0.18 - state.snowCover * 0.32);
}

export function weatherLabel(state: WeatherState): string {
  if (state.snow > 0.4) return "Snow";
  if (state.rain > 0.4) return "Rain";
  if (state.snow > 0.05) return "Flurries";
  if (state.rain > 0.05) return "Drizzle";
  return "Clear";
}
