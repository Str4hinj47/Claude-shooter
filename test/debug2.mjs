const ctxStub = new Proxy({}, { get: (_t, k) => { if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {} }); if (k === "measureText") return () => ({ width: 10 }); if (k === "canvas") return { width: 1024, height: 1024 }; return () => {}; }, set: () => true });
globalThis.document = { createElement: (tag) => tag === "canvas" ? { width: 1024, height: 1024, getContext: () => ctxStub, style: {} } : { style: {} } };
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
const THREE = await import("three");
THREE.CubeCamera.prototype.update = function () {};
THREE.PMREMGenerator.prototype.fromCubemap = function () { return { texture: new THREE.Texture() }; };
THREE.PMREMGenerator.prototype.fromScene = function () { return { texture: new THREE.Texture() }; };
THREE.PMREMGenerator.prototype.dispose = function () {};
const { buildLevel } = await import("../src/game/levels.ts");
const g = new THREE.Group();
const level = buildLevel(1, g, new THREE.Scene(), { toneMappingExposure: 1 });
for (const b of level.aabbs) {
  console.log(`x[${b.min.x.toFixed(2)},${b.max.x.toFixed(2)}] y[${b.min.y.toFixed(2)},${b.max.y.toFixed(2)}] z[${b.min.z.toFixed(2)},${b.max.z.toFixed(2)}]`);
}
