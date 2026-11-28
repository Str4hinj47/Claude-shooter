#pragma once

#include "westgate/GameSession.hpp"
#include <array>
#include <cstddef>
#include <cstdint>
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <string>
#include <vector>

namespace westgate {

enum class WeaponSurfaceMat : uint8_t {
  ReceiverAnodized = 0, // Brushed CNC anodized billet aluminum / slide
  TacticalStipple = 1,  // Laser-stippled hex polymer / M-LOK Cerakote
  MachinedBarrel = 2,   // Lathe-turned fluted steel / diamond-knurled suppressor / rail teeth
  OpticGlass = 3,       // Multi-coated sapphire lens & illuminated reticle
};
static constexpr size_t kWeaponSurfaceMatCount = 4;

struct WeaponPbrTextureSet {
  uint32_t width = 256;
  uint32_t height = 256;
  std::vector<uint8_t> albedoRgba; // RGBA8 sRGB micro-grain, edge wear & surface contrast
  std::vector<uint8_t> normalRgba; // RGBA8 tangent-space normal map
  std::vector<uint8_t> ormRgba;    // R=AO, G=Roughness multiplier, B=Metallic multiplier, A=255
};

enum class WeaponMeshPartId : uint8_t {
  // 5 Firearms x 3 Independent Finish Zones (Body / Accent / Hardware)
  Pistol_Body = 0,
  Pistol_Accent = 1,
  Pistol_Hardware = 2,

  Carbine_Body = 3,
  Carbine_Accent = 4,
  Carbine_Hardware = 5,

  Smg_Body = 6,
  Smg_Accent = 7,
  Smg_Hardware = 8,

  Shotgun_Body = 9,
  Shotgun_Accent = 10,
  Shotgun_Hardware = 11,

  Dmr_Body = 12,
  Dmr_Accent = 13,
  Dmr_Hardware = 14,

  // Modular Optics + Coated Lens + Emissive Reticle
  Optic_RedDot = 15,
  Optic_Holo = 16,
  Optic_Acog = 17,
  Optic_Sniper = 18,
  Optic_Lens = 19,
  Optic_Reticle = 20,

  // Modular Muzzle Devices
  Muzzle_Suppressor = 21,
  Muzzle_Compensator = 22,
  Muzzle_Osprey = 23,
  Muzzle_Wrapped = 24,

  // Modular Underbarrel Attachments
  Under_VertGrip = 25,
  Under_PeqLaser = 26,
  Under_AngledGrip = 27,

  // Modular Magazines
  Mag_Curved = 28,
  Mag_Drum = 29,

  // First-Person Tactical Armored Forearms & Hard-Knuckle Gloves
  Fpv_Forearm = 30,
  Fpv_GloveHand = 31,
};
static constexpr size_t kWeaponMeshPartCount = 32;

struct WeaponPartVertex {
  float px, py, pz;
  float nx, ny, nz;
  float u, v;
  float r, g, b;
  float metallic, roughness;
};
static_assert(sizeof(WeaponPartVertex) == 52, "WeaponPartVertex must match WorldRenderer ModelVertex (52 bytes)");

struct WeaponPartCpuMesh {
  WeaponSurfaceMat material = WeaponSurfaceMat::ReceiverAnodized;
  std::vector<WeaponPartVertex> vertices;
  std::vector<uint32_t> indices;
};

struct WeaponPartDrawInstance {
  WeaponMeshPartId part = WeaponMeshPartId::Carbine_Body;
  glm::vec3 pos{0.0f};
  glm::quat rot{1.0f, 0.0f, 0.0f, 0.0f};
  glm::vec3 scale{1.0f};
  glm::vec3 color{1.0f};
  float emissive = 0.0f;
  float roughness = 0.34f;
  float metallic = 0.85f;
  bool castShadow = true;
};

class WeaponSystem3D {
 public:
  /** Generate 4 procedural 256x256 tileable PBR material texture sets (Albedo + Normal + ORM). */
  static void generateProceduralTextures(
    std::array<WeaponPbrTextureSet, kWeaponSurfaceMatCount>& outTextures
  );

  /** Generate all 32 smooth beveled/cylindrical/fluted/knurled 3D firearm & viewmodel part meshes. */
  static void generateAllPartMeshes(
    std::array<WeaponPartCpuMesh, kWeaponMeshPartCount>& outMeshes
  );

  /** Exact weapon-local Y height (meters above grip origin) of the optical sight axis for ADS alignment. */
  static float opticSightLineY(const WeaponSlotState& w);

  /** Append assembled 3D firearm parts at a grip anchor in world space (used for 3rd-person, NPCs & Gunsmith Studio). */
  static void appendAssembledWeapon(
    const glm::vec3& gripWorldPos,
    const glm::quat& gunWorldRot,
    const WeaponSlotState& w,
    float recoil01,
    float reloadProgress01,
    float uniformScale,
    bool castShadow,
    std::vector<WeaponPartDrawInstance>& outInstances
  );

  /** Append First-Person weapon viewmodel + armored forearms/gloves (or melee boxing fists) locked to the eye camera. */
  static void appendFirstPersonViewmodel(
    const glm::vec3& camPos,
    const glm::vec3& camTarget,
    const WeaponSlotState& activeWep,
    PlayerSuitPreset suitPreset,
    float adsBlend01,
    float recoil01,
    float reloadProgress01,
    float walkSpeedMps,
    bool sprinting,
    float locomotionClock,
    float yawTurnBank,
    const std::string& meleeAttackClip,
    float meleeAttackNorm01,
    bool meleeBlocking,
    std::vector<WeaponPartDrawInstance>& outInstances
  );
};

} // namespace westgate
