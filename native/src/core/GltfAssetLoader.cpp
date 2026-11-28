#define CGLTF_IMPLEMENTATION
#define STB_IMAGE_IMPLEMENTATION
#include <cgltf.h>
#include <meshoptimizer.h>
#include <stb_image.h>

#include "westgate/GltfAssetLoader.hpp"
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <glm/gtc/type_ptr.hpp>
#include <limits>
#include <string>
#include <unordered_map>
#include <vector>

namespace westgate {

namespace {

bool decodeMeshoptBufferViews(
  cgltf_data* data,
  std::vector<std::vector<uint8_t>>& decodedViews,
  std::vector<cgltf_buffer_view*>& overriddenViews,
  std::string* err
) {
  decodedViews.resize(data->buffer_views_count);
  for (cgltf_size i = 0; i < data->buffer_views_count; ++i) {
    cgltf_buffer_view* bv = &data->buffer_views[i];
    if (!bv->has_meshopt_compression) continue;

    const cgltf_meshopt_compression* mc = &bv->meshopt_compression;
    if (!mc->buffer || !mc->buffer->data) {
      if (err) *err = "meshopt buffer_view references unloaded buffer";
      return false;
    }
    const uint8_t* src = static_cast<const uint8_t*>(mc->buffer->data) + mc->offset;
    const size_t dstSize = mc->count * mc->stride;
    decodedViews[i].resize(dstSize);

    int rc = -1;
    if (mc->mode == cgltf_meshopt_compression_mode_attributes) {
      rc = meshopt_decodeVertexBuffer(decodedViews[i].data(), mc->count, mc->stride, src, mc->size);
    } else if (mc->mode == cgltf_meshopt_compression_mode_triangles) {
      rc = meshopt_decodeIndexBuffer(decodedViews[i].data(), mc->count, mc->stride, src, mc->size);
    } else if (mc->mode == cgltf_meshopt_compression_mode_indices) {
      rc = meshopt_decodeIndexSequence(decodedViews[i].data(), mc->count, mc->stride, src, mc->size);
    }
    if (rc != 0) {
      if (err) *err = "meshopt decode failed on buffer_view";
      return false;
    }

    if (mc->mode == cgltf_meshopt_compression_mode_attributes) {
      if (mc->filter == cgltf_meshopt_compression_filter_octahedral) {
        meshopt_decodeFilterOct(decodedViews[i].data(), mc->count, mc->stride);
      } else if (mc->filter == cgltf_meshopt_compression_filter_quaternion) {
        meshopt_decodeFilterQuat(decodedViews[i].data(), mc->count, mc->stride);
      } else if (mc->filter == cgltf_meshopt_compression_filter_exponential) {
        meshopt_decodeFilterExp(decodedViews[i].data(), mc->count, mc->stride);
      }
    }

    bv->data = decodedViews[i].data();
    bv->offset = 0;
    bv->size = dstSize;
    overriddenViews.push_back(bv);
  }
  return true;
}

const uint8_t* getBufferViewData(const cgltf_buffer_view* bv) {
  if (!bv) return nullptr;
  if (bv->data) return static_cast<const uint8_t*>(bv->data);
  if (bv->buffer && bv->buffer->data) {
    return static_cast<const uint8_t*>(bv->buffer->data) + bv->offset;
  }
  return nullptr;
}

glm::mat4 nodeWorldMatrix(const cgltf_node* node) {
  float m[16]{};
  cgltf_node_transform_world(node, m);
  return glm::make_mat4(m);
}

std::vector<glm::mat4> computeRestNodeWorlds(const std::vector<GltfNodeInfo>& nodes) {
  std::vector<glm::mat4> world(nodes.size(), glm::mat4(1.0f));
  std::vector<bool> done(nodes.size(), false);
  auto eval = [&](auto& self, size_t idx) -> glm::mat4 {
    if (done[idx]) return world[idx];
    const auto& n = nodes[idx];
    const glm::mat4 local =
      glm::translate(glm::mat4(1.0f), n.restT) *
      glm::mat4_cast(n.restR) *
      glm::scale(glm::mat4(1.0f), n.restS);
    world[idx] = (n.parent >= 0) ? (self(self, static_cast<size_t>(n.parent)) * local) : local;
    done[idx] = true;
    return world[idx];
  };
  for (size_t i = 0; i < nodes.size(); ++i) eval(eval, i);
  return world;
}

void extractPrimitive(
  const cgltf_data* data,
  const cgltf_primitive& prim,
  bool isSkinned,
  const cgltf_skin* primSkin,
  const std::unordered_map<const cgltf_node*, uint32_t>& nodeToUnifiedJoint,
  const glm::mat4& worldMat,
  const glm::mat3& normalMat,
  GltfPrimitive& outPrim
) {
  const cgltf_accessor* posAcc = nullptr;
  const cgltf_accessor* normAcc = nullptr;
  const cgltf_accessor* uvAcc = nullptr;
  const cgltf_accessor* colAcc = nullptr;
  const cgltf_accessor* jntAcc = nullptr;
  const cgltf_accessor* wgtAcc = nullptr;

  for (cgltf_size ai = 0; ai < prim.attributes_count; ++ai) {
    const auto& attr = prim.attributes[ai];
    if (attr.type == cgltf_attribute_type_position) posAcc = attr.data;
    else if (attr.type == cgltf_attribute_type_normal) normAcc = attr.data;
    else if (attr.type == cgltf_attribute_type_texcoord && attr.index == 0) uvAcc = attr.data;
    else if (attr.type == cgltf_attribute_type_color && attr.index == 0) colAcc = attr.data;
    else if (attr.type == cgltf_attribute_type_joints && attr.index == 0) jntAcc = attr.data;
    else if (attr.type == cgltf_attribute_type_weights && attr.index == 0) wgtAcc = attr.data;
  }
  if (!posAcc || posAcc->count == 0) return;

  outPrim.materialIndex = prim.material ? static_cast<int32_t>(prim.material - data->materials) : -1;
  outPrim.hasSkin = isSkinned && jntAcc && wgtAcc;
  outPrim.vertices.resize(posAcc->count);

  std::vector<float> posBuf(posAcc->count * 3, 0.0f);
  cgltf_accessor_unpack_floats(posAcc, posBuf.data(), posBuf.size());

  std::vector<float> normBuf;
  if (normAcc && normAcc->count == posAcc->count) {
    normBuf.resize(posAcc->count * 3, 0.0f);
    cgltf_accessor_unpack_floats(normAcc, normBuf.data(), normBuf.size());
  }

  std::vector<float> uvBuf;
  if (uvAcc && uvAcc->count == posAcc->count) {
    uvBuf.resize(posAcc->count * 2, 0.0f);
    cgltf_accessor_unpack_floats(uvAcc, uvBuf.data(), uvBuf.size());
  }

  const cgltf_size colComps = colAcc ? cgltf_num_components(colAcc->type) : 0;
  std::vector<float> colBuf;
  if (colAcc && colAcc->count == posAcc->count && (colComps == 3 || colComps == 4)) {
    colBuf.resize(posAcc->count * colComps, 1.0f);
    cgltf_accessor_unpack_floats(colAcc, colBuf.data(), colBuf.size());
  }

  std::vector<float> wgtBuf;
  if (outPrim.hasSkin) {
    wgtBuf.resize(posAcc->count * 4, 0.0f);
    cgltf_accessor_unpack_floats(wgtAcc, wgtBuf.data(), wgtBuf.size());
  }

  for (cgltf_size vi = 0; vi < posAcc->count; ++vi) {
    GltfVertex v;
    glm::vec3 p(posBuf[vi * 3 + 0], posBuf[vi * 3 + 1], posBuf[vi * 3 + 2]);
    if (!std::isfinite(p.x) || !std::isfinite(p.y) || !std::isfinite(p.z)) p = glm::vec3(0.0f);

    if (!isSkinned) {
      p = glm::vec3(worldMat * glm::vec4(p, 1.0f));
    }
    v.position = p;

    if (!normBuf.empty()) {
      glm::vec3 n(normBuf[vi * 3 + 0], normBuf[vi * 3 + 1], normBuf[vi * 3 + 2]);
      if (!isSkinned) n = normalMat * n;
      const float len = glm::length(n);
      v.normal = len > 1e-5f ? n / len : glm::vec3(0.0f, 1.0f, 0.0f);
    }
    if (!uvBuf.empty()) {
      glm::vec2 uv(uvBuf[vi * 2 + 0], uvBuf[vi * 2 + 1]);
      if (prim.material && prim.material->has_pbr_metallic_roughness &&
          prim.material->pbr_metallic_roughness.base_color_texture.has_transform) {
        const cgltf_texture_transform& tr = prim.material->pbr_metallic_roughness.base_color_texture.transform;
        glm::vec2 s(uv.x * tr.scale[0], uv.y * tr.scale[1]);
        if (std::abs(tr.rotation) > 1e-6f) {
          const float cr = std::cos(tr.rotation);
          const float sr = std::sin(tr.rotation);
          // glTF KHR_texture_transform rotates around UV origin with +V downward
          s = glm::vec2(s.x * cr + s.y * sr, -s.x * sr + s.y * cr);
        }
        uv = s + glm::vec2(tr.offset[0], tr.offset[1]);
      }
      v.uv = uv;
    }
    if (!colBuf.empty()) {
      if (colComps == 4) {
        v.color = glm::vec4(colBuf[vi * 4 + 0], colBuf[vi * 4 + 1], colBuf[vi * 4 + 2], colBuf[vi * 4 + 3]);
      } else {
        v.color = glm::vec4(colBuf[vi * 3 + 0], colBuf[vi * 3 + 1], colBuf[vi * 3 + 2], 1.0f);
      }
    }
    if (outPrim.hasSkin) {
      cgltf_uint j4[4]{0, 0, 0, 0};
      cgltf_accessor_read_uint(jntAcc, vi, j4, 4);
      if (primSkin && !nodeToUnifiedJoint.empty()) {
        for (int k = 0; k < 4; ++k) {
          if (j4[k] < primSkin->joints_count && primSkin->joints[j4[k]]) {
            auto it = nodeToUnifiedJoint.find(primSkin->joints[j4[k]]);
            if (it != nodeToUnifiedJoint.end()) j4[k] = it->second;
          }
        }
      }
      v.joints = glm::uvec4(j4[0], j4[1], j4[2], j4[3]);
      glm::vec4 w(wgtBuf[vi * 4 + 0], wgtBuf[vi * 4 + 1], wgtBuf[vi * 4 + 2], wgtBuf[vi * 4 + 3]);
      const float sum = w.x + w.y + w.z + w.w;
      v.weights = sum > 1e-5f ? (w / sum) : glm::vec4(1.0f, 0.0f, 0.0f, 0.0f);
    }
    outPrim.vertices[vi] = v;
  }

  if (prim.indices && prim.indices->count > 0) {
    outPrim.indices.resize(prim.indices->count);
    cgltf_accessor_unpack_indices(prim.indices, outPrim.indices.data(), sizeof(uint32_t), prim.indices->count);
  } else {
    outPrim.indices.resize(posAcc->count);
    for (cgltf_size i = 0; i < posAcc->count; ++i) outPrim.indices[i] = static_cast<uint32_t>(i);
  }
}

} // namespace

bool GltfAssetLoader::loadGlb(const std::string& path, GltfModel& outModel, bool decodeTextures, std::string* err) {
  cgltf_options options{};
  cgltf_data* data = nullptr;
  cgltf_result res = cgltf_parse_file(&options, path.c_str(), &data);
  if (res != cgltf_result_success || !data) {
    if (err) *err = "cgltf_parse_file failed for " + path;
    return false;
  }

  std::vector<cgltf_buffer_view*> overriddenViews;
  auto cleanup = [&]() {
    for (cgltf_buffer_view* bv : overriddenViews) {
      bv->data = nullptr;
    }
    if (data) cgltf_free(data);
  };

  res = cgltf_load_buffers(&options, data, path.c_str());
  if (res != cgltf_result_success) {
    cleanup();
    if (err) *err = "cgltf_load_buffers failed for " + path;
    return false;
  }

  std::vector<std::vector<uint8_t>> decodedViews;
  if (!decodeMeshoptBufferViews(data, decodedViews, overriddenViews, err)) {
    cleanup();
    return false;
  }

  outModel = GltfModel{};
  outModel.sourcePath = path;
  outModel.animationCount = static_cast<uint32_t>(data->animations_count);
  for (cgltf_size si = 0; si < data->skins_count; ++si) {
    outModel.boneCount += static_cast<uint32_t>(data->skins[si].joints_count);
  }

  // Node hierarchy
  outModel.nodes.resize(data->nodes_count);
  for (cgltf_size ni = 0; ni < data->nodes_count; ++ni) {
    const cgltf_node& cn = data->nodes[ni];
    GltfNodeInfo& dst = outModel.nodes[ni];
    dst.name = cn.name ? cn.name : "";
    dst.parent = cn.parent ? static_cast<int32_t>(cn.parent - data->nodes) : -1;
    if (cn.has_translation) dst.restT = glm::vec3(cn.translation[0], cn.translation[1], cn.translation[2]);
    if (cn.has_rotation) dst.restR = glm::normalize(glm::quat(cn.rotation[3], cn.rotation[0], cn.rotation[1], cn.rotation[2]));
    if (cn.has_scale) dst.restS = glm::vec3(cn.scale[0], cn.scale[1], cn.scale[2]);
  }

  // Unified Skin (merges multi-skin GLBs such as soldier.glb vanguard_Mesh + vanguard_visor onto one joint palette)
  std::unordered_map<const cgltf_node*, uint32_t> nodeToUnifiedJoint;
  if (data->skins_count > 0) {
    // Pick the skin with the largest joint count as primary so joint ordering stays canonical
    cgltf_size primarySkinIdx = 0;
    for (cgltf_size si = 1; si < data->skins_count; ++si) {
      if (data->skins[si].joints_count > data->skins[primarySkinIdx].joints_count) primarySkinIdx = si;
    }
    auto appendSkinJoints = [&](const cgltf_skin& cs) {
      std::vector<float> ibmFloats;
      const bool hasIbm = (cs.inverse_bind_matrices && cs.inverse_bind_matrices->count >= cs.joints_count);
      if (hasIbm) {
        ibmFloats.resize(cs.joints_count * 16, 0.0f);
        cgltf_accessor_unpack_floats(cs.inverse_bind_matrices, ibmFloats.data(), ibmFloats.size());
      }
      for (cgltf_size ji = 0; ji < cs.joints_count; ++ji) {
        const cgltf_node* jn = cs.joints[ji];
        if (!jn || nodeToUnifiedJoint.count(jn)) continue;
        const uint32_t newIdx = static_cast<uint32_t>(outModel.skin.jointNodeIndices.size());
        nodeToUnifiedJoint[jn] = newIdx;
        outModel.skin.jointNodeIndices.push_back(static_cast<int32_t>(jn - data->nodes));
        outModel.skin.inverseBindMatrices.push_back(hasIbm ? glm::make_mat4(&ibmFloats[ji * 16]) : glm::mat4(1.0f));
      }
    };
    appendSkinJoints(data->skins[primarySkinIdx]);
    for (cgltf_size si = 0; si < data->skins_count; ++si) {
      if (si != primarySkinIdx) appendSkinJoints(data->skins[si]);
    }
    outModel.skin.valid = !outModel.skin.jointNodeIndices.empty();
    outModel.boneCount = static_cast<uint32_t>(outModel.skin.jointNodeIndices.size());
  }

  // Animations
  outModel.animations.reserve(data->animations_count);
  for (cgltf_size ai = 0; ai < data->animations_count; ++ai) {
    const cgltf_animation& ca = data->animations[ai];
    GltfAnimationClip clip;
    clip.name = ca.name ? ca.name : ("anim_" + std::to_string(ai));
    for (cgltf_size ci = 0; ci < ca.channels_count; ++ci) {
      const cgltf_animation_channel& ch = ca.channels[ci];
      if (!ch.target_node || !ch.sampler || !ch.sampler->input || !ch.sampler->output) continue;
      if (ch.target_path != cgltf_animation_path_type_translation &&
          ch.target_path != cgltf_animation_path_type_rotation &&
          ch.target_path != cgltf_animation_path_type_scale) {
        continue;
      }
      GltfAnimChannel dst;
      dst.targetNode = static_cast<int32_t>(ch.target_node - data->nodes);
      dst.targetBoneName = ch.target_node->name ? ch.target_node->name : "";
      if (ch.target_path == cgltf_animation_path_type_translation) dst.path = GltfAnimPath::Translation;
      else if (ch.target_path == cgltf_animation_path_type_rotation) dst.path = GltfAnimPath::Rotation;
      else dst.path = GltfAnimPath::Scale;

      const cgltf_size keyCount = ch.sampler->input->count;
      if (keyCount == 0) continue;
      dst.times.resize(keyCount);
      cgltf_accessor_unpack_floats(ch.sampler->input, dst.times.data(), keyCount);
      clip.duration = std::max(clip.duration, dst.times.back());

      const size_t comps = (dst.path == GltfAnimPath::Rotation) ? 4 : 3;
      dst.values.resize(keyCount * comps);
      cgltf_accessor_unpack_floats(ch.sampler->output, dst.values.data(), dst.values.size());
      clip.channels.push_back(std::move(dst));
    }
    if (!clip.channels.empty()) {
      outModel.animations.push_back(std::move(clip));
    }
  }

  // Materials
  outModel.materials.reserve(data->materials_count);
  for (cgltf_size mi = 0; mi < data->materials_count; ++mi) {
    const cgltf_material& m = data->materials[mi];
    GltfMaterialInfo info;
    info.name = m.name ? m.name : "";
    info.emissiveFactor = glm::vec3(m.emissive_factor[0], m.emissive_factor[1], m.emissive_factor[2]);
    info.transparent = (m.alpha_mode == cgltf_alpha_mode_blend);
    if (m.has_pbr_metallic_roughness) {
      const auto& p = m.pbr_metallic_roughness;
      info.baseColor = glm::vec4(p.base_color_factor[0], p.base_color_factor[1], p.base_color_factor[2], p.base_color_factor[3]);
      if (info.baseColor.a < 0.985f) info.transparent = true;
      info.metallic = p.metallic_factor;
      info.roughness = p.roughness_factor;
      if (p.base_color_texture.texture && p.base_color_texture.texture->image) {
        info.baseColorTexIndex = static_cast<int32_t>(p.base_color_texture.texture->image - data->images);
      }
      if (p.metallic_roughness_texture.texture && p.metallic_roughness_texture.texture->image) {
        info.metallicRoughnessTexIndex = static_cast<int32_t>(p.metallic_roughness_texture.texture->image - data->images);
      }
    }
    if (m.normal_texture.texture && m.normal_texture.texture->image) {
      info.normalTexIndex = static_cast<int32_t>(m.normal_texture.texture->image - data->images);
      info.normalScale = m.normal_texture.scale > 0.0f ? m.normal_texture.scale : 1.0f;
    }
    if (m.emissive_texture.texture && m.emissive_texture.texture->image) {
      info.emissiveTexIndex = static_cast<int32_t>(m.emissive_texture.texture->image - data->images);
    }
    outModel.materials.push_back(std::move(info));
  }

  // Embedded PNG/JPG textures
  if (decodeTextures) {
    outModel.textures.resize(data->images_count);
    for (cgltf_size ii = 0; ii < data->images_count; ++ii) {
      const cgltf_image& img = data->images[ii];
      if (!img.buffer_view) continue;
      const uint8_t* raw = getBufferViewData(img.buffer_view);
      if (!raw) continue;
      int w = 0, h = 0, comp = 0;
      uint8_t* rgba = stbi_load_from_memory(raw, static_cast<int>(img.buffer_view->size), &w, &h, &comp, 4);
      if (rgba) {
        outModel.textures[ii].width = static_cast<uint32_t>(w);
        outModel.textures[ii].height = static_cast<uint32_t>(h);
        outModel.textures[ii].rgba8.assign(rgba, rgba + static_cast<size_t>(w) * h * 4);
        stbi_image_free(rgba);
      }
    }
  }

  // Traverse nodes with meshes so static node scales/rotations (e.g. 100x Z-up -> Y-up) are baked cleanly!
  bool anyNodeMesh = false;
  for (cgltf_size ni = 0; ni < data->nodes_count; ++ni) {
    const cgltf_node& node = data->nodes[ni];
    if (!node.mesh) continue;
    anyNodeMesh = true;
    const bool isSkinned = (node.skin != nullptr) && outModel.skin.valid;
    const glm::mat4 worldMat = nodeWorldMatrix(&node);
    glm::mat3 m3(worldMat);
    for (int c = 0; c < 3; ++c) {
      const float cl = glm::length(m3[c]);
      if (cl > 1e-12f) m3[c] /= cl;
    }
    const float det = glm::determinant(m3);
    const glm::mat3 normalMat = (std::abs(det) > 1e-6f) ? glm::transpose(glm::inverse(m3)) : glm::mat3(1.0f);
    for (cgltf_size pi = 0; pi < node.mesh->primitives_count; ++pi) {
      const cgltf_primitive& prim = node.mesh->primitives[pi];
      if (prim.type != cgltf_primitive_type_triangles) continue;
      GltfPrimitive outPrim;
      outPrim.nodeIndex = static_cast<int32_t>(ni);
      extractPrimitive(data, prim, isSkinned, node.skin, nodeToUnifiedJoint, worldMat, normalMat, outPrim);
      if (!outPrim.vertices.empty()) {
        outModel.primitives.push_back(std::move(outPrim));
      }
    }
  }

  // Animation-only GLBs have nodes without meshes; static mesh GLBs without scene nodes fall back to data->meshes
  if (!anyNodeMesh && data->meshes_count > 0) {
    for (cgltf_size mi = 0; mi < data->meshes_count; ++mi) {
      const cgltf_mesh& mesh = data->meshes[mi];
      for (cgltf_size pi = 0; pi < mesh.primitives_count; ++pi) {
        const cgltf_primitive& prim = mesh.primitives[pi];
        if (prim.type != cgltf_primitive_type_triangles) continue;
        GltfPrimitive outPrim;
        extractPrimitive(data, prim, false, nullptr, nodeToUnifiedJoint, glm::mat4(1.0f), glm::mat3(1.0f), outPrim);
        if (!outPrim.vertices.empty()) {
          outModel.primitives.push_back(std::move(outPrim));
        }
      }
    }
  }

  // Compute rest-pose bounds (using skinning matrices for skinned meshes so bounds are in meters)
  if (!outModel.primitives.empty()) {
    glm::vec3 bMin(std::numeric_limits<float>::max());
    glm::vec3 bMax(std::numeric_limits<float>::lowest());
    std::vector<glm::mat4> skinRestMats;
    if (outModel.skin.valid) {
      const auto nodeWorlds = computeRestNodeWorlds(outModel.nodes);
      skinRestMats.resize(outModel.skin.jointNodeIndices.size(), glm::mat4(1.0f));
      for (size_t ji = 0; ji < skinRestMats.size(); ++ji) {
        const int32_t jn = outModel.skin.jointNodeIndices[ji];
        if (jn >= 0 && static_cast<size_t>(jn) < nodeWorlds.size()) {
          skinRestMats[ji] = nodeWorlds[jn] * outModel.skin.inverseBindMatrices[ji];
        }
      }
    }
    for (const auto& prim : outModel.primitives) {
      for (const auto& v : prim.vertices) {
        glm::vec3 p = v.position;
        if (prim.hasSkin && !skinRestMats.empty()) {
          glm::mat4 m(0.0f);
          for (int k = 0; k < 4; ++k) {
            const float w = v.weights[k];
            const uint32_t ji = v.joints[k];
            if (w > 0.0f && ji < skinRestMats.size()) {
              m += skinRestMats[ji] * w;
            }
          }
          p = glm::vec3(m * glm::vec4(p, 1.0f));
        }
        bMin = glm::min(bMin, p);
        bMax = glm::max(bMax, p);
      }
    }
    outModel.boundsMin = bMin;
    outModel.boundsMax = bMax;
  }

  cleanup();
  // Animation-only GLBs (like public/animations/combat/*.glb) legitimately have 0 primitives!
  return !outModel.primitives.empty() || !outModel.animations.empty();
}

} // namespace westgate
