import * as THREE from "three";
import type { CarId } from "./catalog";

export type IndicatorUniforms = {
  left: { value: number };
  right: { value: number };
  viewZ: { value: number };
  brake: { value: number };
};

type Config = {
  materials: string[];
  x: [number, number];
  y: [number, number];
  z: number;
  color: "amber" | "red";
  ellipse?: [number, number, number, number];
};

export const INDICATOR_LAYOUTS: Record<CarId, Config> = {
  golf: { materials: ["taillight__Rear-lights"], x: [0.5, 0.82], y: [0.8, 0.88], z: 1.63, color: "amber" },
  mercedes: { materials: ["photo__W222 - Photo Textures Rough 0"], x: [0.57, 0.86], y: [0.58, 0.72], z: 2.04, color: "amber" },
  audi: {
    materials: ["taillight__Rear_secondary_emission", "taillight__Rear LIght_clear", "taillight__Rear_main_emission", "other__Material.005"],
    x: [0.35, 0.82],
    y: [0.86, 0.96],
    z: 1.95,
    color: "amber",
  },
  mustang: { materials: ["taillight__M_Tailight1", "taillight__M_Tailight2"], x: [0.35, 0.72], y: [0.65, 0.78], z: 2.18, color: "red" },
  ferrari: {
    materials: ["taillight__Rear_Light_Cover.000", "taillight__Rear_Light_RedSide.000", "taillight__Rear_Light_Tex.000"],
    x: [0.55, 0.86],
    y: [0.67, 0.85],
    z: 1.61,
    color: "amber",
    ellipse: [0.665, 0.75, 0.76, 0.06],
  },
  r8: { materials: ["taillight__r8"], x: [0.36, 0.85], y: [0.62, 0.674], z: 1.8, color: "amber" },
  challenger: { materials: ["taillight__challenger"], x: [0.25, 0.8], y: [0.8, 0.96], z: 2.32, color: "red" },
  rangerover: { materials: ["taillight__RangeRover"], x: [0.25, 0.95], y: [0.6, 1.15], z: 2.35, color: "amber" },
};

export function isIndicatorMaterial(id: CarId, material: THREE.Material) {
  return INDICATOR_LAYOUTS[id].materials.includes(material.name);
}

export function indicatorMaterial(
  id: CarId,
  source: THREE.Material,
  meshToCar: THREE.Matrix4,
  state: IndicatorUniforms,
) {
  const layout = INDICATOR_LAYOUTS[id];
  const material = source.clone() as THREE.MeshStandardMaterial;
  const f = (n: number) => n.toFixed(5);
  const ellipse = layout.ellipse
    ? `
    float cx = indicatorPos.x < 0.0 ? -${f(layout.ellipse[0])} : ${f(layout.ellipse[1])};
    vec2 circle = vec2((indicatorPos.x - cx) / ${f(layout.ellipse[3])}, (indicatorPos.y - ${f(layout.ellipse[2])}) / ${f(layout.ellipse[3])});
    zone *= 1.0 - smoothstep(0.86, 1.0, length(circle));`
    : "";
  const color = layout.color === "red" ? "vec3(1.0, 0.015, 0.008)" : "vec3(1.0, 0.30, 0.008)";
  const dark = layout.color === "red" ? "step(sideState, -0.5) * zone" : "0.0";
  if (id === "golf") material.userData.selectiveBrake = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.indicatorToCar = { value: meshToCar };
    shader.uniforms.indicatorLeft = state.left;
    shader.uniforms.indicatorRight = state.right;
    shader.uniforms.indicatorViewZ = state.viewZ;
    shader.uniforms.brakeLevel = state.brake;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 indicatorToCar;\nvarying vec3 indicatorPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nindicatorPos = (indicatorToCar * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 indicatorPos;\nuniform float indicatorLeft, indicatorRight, indicatorViewZ, brakeLevel;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float sideState = indicatorPos.x < 0.0 ? indicatorLeft : indicatorRight;
        float ax = abs(indicatorPos.x);
        float zone = step(0.0, indicatorViewZ) * step(${f(layout.x[0])}, ax) * step(ax, ${f(layout.x[1])})
          * step(${f(layout.y[0])}, indicatorPos.y) * step(indicatorPos.y, ${f(layout.y[1])}) * step(${f(layout.z)}, indicatorPos.z);
        ${ellipse}
        float signalOn = zone * step(0.5, sideState);
        float signalOff = ${dark};
        diffuseColor.rgb = mix(diffuseColor.rgb, ${color}, signalOn);
        diffuseColor.rgb *= 1.0 - signalOff * 0.80;
      `,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance = mix(totalEmissiveRadiance, ${color} * 2.0, signalOn);
        totalEmissiveRadiance *= 1.0 - signalOff * 0.95;
        ${
          id === "golf"
            ? `
        float redLens = smoothstep(0.06, 0.22, diffuseColor.r - max(diffuseColor.g, diffuseColor.b));
        float lowerLens = 1.0 - smoothstep(0.795, 0.815, indicatorPos.y);
        totalEmissiveRadiance += vec3(1.0, 0.012, 0.006) * brakeLevel * redLens * lowerLens * 0.75;
        `
            : ""
        }
      `,
      );
  };
  material.customProgramCacheKey = () => `rear-indicator-${id}-v3`;
  return material;
}

const FRONT_MATERIALS: Record<CarId, string[]> = {
  golf: ["chrome__Chrome", "headlight__Glass-light-cover", "headlight__Headlight1"],
  mercedes: ["photo__W222 - Photo Textures", "photo__W222 - Photo Textures Rough 0"],
  audi: ["headlight__Front DRL", "headlight__Bright_front_headlight", "chrome__Chrome_Light", "other__Material.001"],
  mustang: ["headlight__M_HeadLight2", "other__M_TurnSignalLight1"],
  ferrari: ["headlight__Main_Light_Cover.000", "headlight__Front_Light_Covers.000", "headlight__LEDsOn.000", "headlight__LEDsOff.000"],
  r8: ["headlight__r8"],
  challenger: ["headlight__challenger"],
  rangerover: ["headlight__RangeRover"],
};

export function isFrontIndicatorMaterial(id: CarId, material: THREE.Material): boolean {
  return FRONT_MATERIALS[id].includes(material.name);
}

const FRONT_ZONES: Record<CarId, string> = {
  golf: `step(fP.z, -1.74) * (1.0 - smoothstep(0.82, 1.0, length(vec2((fX - 0.598) / 0.064, (fP.y - 0.662) / 0.055))))`,
  mercedes: `step(fP.z, -1.90) * step(0.52, fX) * step(fX, 0.89) * step(0.58, fP.y) * step(fP.y, 0.84) * smoothstep(0.35, 0.75, min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)))`,
  audi: `step(fP.z, -1.83) * step(0.53, fX) * step(fX, 0.88) * (1.0 - smoothstep(0.008, 0.018, abs(fP.y - (0.575 + fX * 0.12))))`,
  mustang: `step(fP.z, -1.82) * (step(0.33, fP.y) * step(fP.y, 0.39) * step(0.38, fX) * step(fX, 0.51) + step(0.39, fP.y) * step(fP.y, 0.455) * step(0.79, fX) * step(fX, 0.84))`,
  ferrari: `step(-1.68, fP.z) * step(fP.z, -1.37) * step(0.56, fP.y) * (1.0 - smoothstep(0.014, 0.028, abs(fX - ((fP.x < 0.0 ? 0.67 : 0.71) + (fP.z + 1.63) * 0.17))))`,
  r8: `step(fP.z, -1.67) * step(0.42, fX) * step(fX, 0.84) * step(0.51 + (fX - 0.43) * 0.19, fP.y)`,
  challenger: `step(fP.z, -2.20) * step(0.47, fX) * step(fX, 0.84) * smoothstep(0.048, 0.057, length(vec2(fX - (fX < 0.655 ? 0.570 : 0.744), fP.y - 0.732))) * (1.0 - smoothstep(0.076, 0.084, length(vec2(fX - (fX < 0.655 ? 0.570 : 0.744), fP.y - 0.732))))`,
  rangerover: `step(fP.z, -2.20) * step(0.45, fX) * step(fX, 0.92)`,
};

export function addFrontIndicator(
  id: CarId,
  material: THREE.MeshStandardMaterial,
  meshToCar: THREE.Matrix4,
  state: IndicatorUniforms,
): THREE.MeshStandardMaterial {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.frontIndicatorToCar = { value: meshToCar };
    shader.uniforms.frontIndicatorLeft = state.left;
    shader.uniforms.frontIndicatorRight = state.right;
    shader.uniforms.frontIndicatorViewZ = state.viewZ;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 frontIndicatorToCar;\nvarying vec3 frontIndicatorPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nfrontIndicatorPos = (frontIndicatorToCar * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 frontIndicatorPos;\nuniform float frontIndicatorLeft, frontIndicatorRight, frontIndicatorViewZ;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 fP = frontIndicatorPos;
        float fX = abs(fP.x);
        float fSide = fP.x < 0.0 ? frontIndicatorLeft : frontIndicatorRight;
        float fZone = step(frontIndicatorViewZ, 0.0) * (${FRONT_ZONES[id]});
        float fOn = fZone * step(0.5, fSide);
        float fOff = fZone * step(fSide, -0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.24, 0.004), fOn);
        diffuseColor.rgb *= 1.0 - fOff * 0.72;
      `,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(1.0, 0.24, 0.004) * 2.0, fOn);
        totalEmissiveRadiance *= 1.0 - fOff * 0.9;
      `,
      );
  };
  material.customProgramCacheKey = () => `${previousKey}|front-indicator-${id}-v1`;
  return material;
}
