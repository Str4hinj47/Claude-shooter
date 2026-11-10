const ctxStub = new Proxy({}, { get: (_t, k) => { if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {} }); if (k === "measureText") return () => ({ width: 10 }); if (k === "canvas") return { width: 1024, height: 1024 }; return () => {}; }, set: () => true });
globalThis.document = { createElement: (tag) => tag === "canvas" ? { width: 1024, height: 1024, getContext: () => ctxStub, style: {} } : { style: {} } };
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
const THREE = await import("three");
THREE.CubeCamera.prototype.update = function () {};
THREE.PMREMGenerator.prototype.fromCubemap = function () { return { texture: new THREE.Texture() }; };
THREE.PMREMGenerator.prototype.fromScene = function () { return { texture: new THREE.Texture() }; };
THREE.PMREMGenerator.prototype.dispose = function () {};
const { buildLevel } = await import("../src/game/levels.ts");
const fakeRenderer = { toneMappingExposure: 1 };
const main = new THREE.Scene();

for (const [mid, points] of [[4, [[14,12],[-16,14],[14,-4]]], [5, [[0,-40]]]]) {
  const g = new THREE.Group();
  const level = buildLevel(mid, g, main, fakeRenderer);
  console.log("=== M" + mid + " ===");
  for (const [x, z] of points) {
    for (const b of level.aabbs) {
      if (0 + 1.8 < b.min.y || 0 > b.max.y) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if (Math.hypot(x - cx, z - cz) < 0.6) {
        console.log(`  (${x},${z}) vs AABB x[${b.min.x.toFixed(2)},${b.max.x.toFixed(2)}] y[${b.min.y.toFixed(2)},${b.max.y.toFixed(2)}] z[${b.min.z.toFixed(2)},${b.max.z.toFixed(2)}]`);
      }
    }
  }
  // list container-like AABBs
  console.log("  tall thin AABBs (containers/poles):");
  for (const b of level.aabbs) {
    const w = b.max.x - b.min.x, d = b.max.z - b.min.z, h = b.max.y - b.min.y;
    if (h > 2 && h < 16 && (w > 5 || d > 5)) console.log(`    x[${b.min.x.toFixed(1)},${b.max.x.toFixed(1)}] y[${b.min.y.toFixed(1)},${b.max.y.toFixed(1)}] z[${b.min.z.toFixed(1)},${b.max.z.toFixed(1)}]  (${w.toFixed(1)}x${h.toFixed(1)}x${d.toFixed(1)})`);
  }
}
