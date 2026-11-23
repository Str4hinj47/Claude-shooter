import * as THREE from "three";
import type { TrafficId } from "./catalog";

type Lamps = { front: [number, number, number]; rear: [number, number, number] };
export const LAMP_POSITIONS: Record<TrafficId, Lamps> = {
  golf: { front: [0.54, 0.67, -1.93], rear: [0.67, 0.76, 1.94] },
  mercedes: { front: [0.68, 0.72, -2.39], rear: [0.72, 0.68, 2.49] },
  audi: { front: [0.69, 0.67, -2.25], rear: [0.7, 0.87, 2.32] },
  mustang: { front: [0.7, 0.69, -2.16], rear: [0.54, 0.72, 2.3] },
  ferrari: { front: [0.7, 0.68, -1.68], rear: [0.71, 0.76, 1.88] },
  r8: { front: [0.65, 0.56, -1.91], rear: [0.65, 0.69, 2.06] },
  challenger: { front: [0.65, 0.73, -2.3], rear: [0.59, 0.87, 2.39] },
  rangerover: { front: [0.74, 0.78, -2.46], rear: [0.8, 0.88, 2.41] },
  semi: { front: [0.75, 0.74, -8.08], rear: [0.84, 0.76, 7.99] },
  kraz: { front: [0.79, 0.78, -4.08], rear: [0.85, 0.85, 3.9] },
};

let glow: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (glow) return glow;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,.65)");
  g.addColorStop(0.45, "rgba(255,255,255,.14)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

export type VehicleLights = {
  front: THREE.Sprite[];
  rear: THREE.Sprite[];
  beam?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
};

export function addVehicleLights(group: THREE.Group, id: TrafficId, npc: boolean): VehicleLights {
  const profile = LAMP_POSITIONS[id];
  const make = (pos: [number, number, number], color: number, size: number, name: string) =>
    [-1, 1].map((side) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
        }),
      );
      sprite.name = name;
      sprite.position.set(side * pos[0], pos[1], pos[2]);
      sprite.scale.set(size, size * 0.7, 1);
      group.add(sprite);
      return sprite;
    });
  const lights: VehicleLights = {
    front: make(profile.front, 0xe7f5ff, 0.3, "front-lamp-glow"),
    rear: make(profile.rear, 0xff1712, 0.34, "rear-lamp-glow"),
  };
  if (npc) {
    const length = 12;
    const width = 6.5;
    const geo = new THREE.PlaneGeometry(width, length, 1, 8);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.08, profile.front[2] - length / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: { strength: { value: 0 }, offset: { value: profile.front[0] / width } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec2 vUv;uniform float strength,offset;void main(){float d=vUv.y;float width=mix(.035,.25,d);float left=1.0-smoothstep(width*.25,width,abs(vUv.x-(.5-offset)));float right=1.0-smoothstep(width*.25,width,abs(vUv.x-(.5+offset)));float fade=smoothstep(0.0,.06,d)*(1.0-smoothstep(.32,1.0,d));gl_FragColor=vec4(.73,.82,1.0,max(left,right)*fade*strength);}`,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = "npc-headlight-beams";
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    lights.beam = mesh;
  }
  group.userData.vehicleLights = lights;
  return lights;
}

const cameraLocal = new THREE.Vector3();
export function updateVehicleLights(group: THREE.Group, camera: THREE.Camera, darkness: number, braking: boolean) {
  const lights = group.userData.vehicleLights as VehicleLights | undefined;
  if (!lights) return;
  group.updateWorldMatrix(true, false);
  cameraLocal.copy(camera.position);
  group.worldToLocal(cameraLocal);
  const frontVisible = cameraLocal.z < 0;
  const rearVisible = cameraLocal.z > 0;
  const d = THREE.MathUtils.clamp(darkness, 0, 1);
  for (const mat of (group.userData.headlightMaterials ?? []) as THREE.MeshStandardMaterial[]) {
    mat.emissiveIntensity = mat.name === "headlight__r8" ? 0.3 + d * 0.42 : 0.45 + d * 0.5;
  }
  for (const mat of (group.userData.brakeMaterials ?? []) as THREE.MeshStandardMaterial[]) {
    mat.emissiveIntensity = braking && !mat.userData.selectiveBrake ? 2.6 : 0.55;
  }
  const ind = group.userData.indicatorState as { brake?: { value: number } } | undefined;
  if (ind?.brake) ind.brake.value = braking ? 1 : 0;
  for (const sprite of lights.front) sprite.material.opacity = frontVisible ? 0.3 + d * 0.52 : 0;
  for (const sprite of lights.rear) sprite.material.opacity = rearVisible ? (braking ? 0.85 : 0.35 + d * 0.34) : 0;
  if (lights.beam) {
    lights.beam.material.uniforms.strength.value = 0.08 + d * 0.45;
  }
}

export function disposeVehicleLights(group: THREE.Group) {
  const lights = group.userData.vehicleLights as VehicleLights | undefined;
  if (lights?.beam) {
    lights.beam.geometry.dispose();
    lights.beam.material.dispose();
  }
}
