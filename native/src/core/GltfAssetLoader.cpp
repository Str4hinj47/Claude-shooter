#define CGLTF_IMPLEMENTATION
#define STB_IMAGE_IMPLEMENTATION
#include <cgltf.h>
#include <meshoptimizer.h>
#include <stb_image.h>

#include "westgate/GltfAssetLoader.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
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

    // Redirect buffer_view to point at decoded buffer in memory so cgltf_accessor_unpack_* works seamlessly.
    // Must clear bv->data before cgltf_free(data) because cgltf_free calls free() on non-null bv->data!
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

  // Note: redirect cgltf_buffer_view::data requires cgltf_accessor_read_float to check bv->data;
  // cgltf_accessor_unpack_floats reads via cgltf_buffer_view_data(bv) which prefers bv->data over bv->buffer->data!
  outModel = GltfModel{};
  outModel.sourcePath = path;
  outModel.animationCount = static_cast<uint32_t>(data->animations_count);
  for (cgltf_size si = 0; si < data->skins_count; ++si) {
    outModel.boneCount += static_cast<uint32_t>(data->skins[si].joints_count);
  }

  // Materials
  outModel.materials.reserve(data->materials_count);
  for (cgltf_size mi = 0; mi < data->materials_count; ++mi) {
    const cgltf_material& m = data->materials[mi];
    GltfMaterialInfo info;
    info.name = m.name ? m.name : "";
    if (m.has_pbr_metallic_roughness) {
      const auto& p = m.pbr_metallic_roughness;
      info.baseColor = glm::vec4(p.base_color_factor[0], p.base_color_factor[1], p.base_color_factor[2], p.base_color_factor[3]);
      info.metallic = p.metallic_factor;
      info.roughness = p.roughness_factor;
      if (p.base_color_texture.texture && p.base_color_texture.texture->image) {
        info.baseColorTexIndex = static_cast<int32_t>(p.base_color_texture.texture->image - data->images);
      }
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

  glm::vec3 bMin(std::numeric_limits<float>::max());
  glm::vec3 bMax(std::numeric_limits<float>::lowest());

  for (cgltf_size mi = 0; mi < data->meshes_count; ++mi) {
    const cgltf_mesh& mesh = data->meshes[mi];
    for (cgltf_size pi = 0; pi < mesh.primitives_count; ++pi) {
      const cgltf_primitive& prim = mesh.primitives[pi];
      if (prim.type != cgltf_primitive_type_triangles) continue;

      const cgltf_accessor* posAcc = nullptr;
      const cgltf_accessor* normAcc = nullptr;
      const cgltf_accessor* uvAcc = nullptr;
      for (cgltf_size ai = 0; ai < prim.attributes_count; ++ai) {
        const auto& attr = prim.attributes[ai];
        if (attr.type == cgltf_attribute_type_position) posAcc = attr.data;
        else if (attr.type == cgltf_attribute_type_normal) normAcc = attr.data;
        else if (attr.type == cgltf_attribute_type_texcoord && attr.index == 0) uvAcc = attr.data;
      }
      if (!posAcc || posAcc->count == 0) continue;

      GltfPrimitive outPrim;
      outPrim.materialIndex = prim.material ? static_cast<int32_t>(prim.material - data->materials) : -1;
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

      for (cgltf_size vi = 0; vi < posAcc->count; ++vi) {
        GltfVertex v;
        v.position = glm::vec3(posBuf[vi * 3 + 0], posBuf[vi * 3 + 1], posBuf[vi * 3 + 2]);
        if (!std::isfinite(v.position.x) || !std::isfinite(v.position.y) || !std::isfinite(v.position.z)) {
          v.position = glm::vec3(0.0f);
        }
        bMin = glm::min(bMin, v.position);
        bMax = glm::max(bMax, v.position);

        if (!normBuf.empty()) {
          v.normal = glm::vec3(normBuf[vi * 3 + 0], normBuf[vi * 3 + 1], normBuf[vi * 3 + 2]);
          const float len = glm::length(v.normal);
          v.normal = len > 1e-5f ? v.normal / len : glm::vec3(0.0f, 1.0f, 0.0f);
        }
        if (!uvBuf.empty()) {
          v.uv = glm::vec2(uvBuf[vi * 2 + 0], uvBuf[vi * 2 + 1]);
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

      outModel.primitives.push_back(std::move(outPrim));
    }
  }

  if (!outModel.primitives.empty()) {
    outModel.boundsMin = bMin;
    outModel.boundsMax = bMax;
  }

  cleanup();
  return !outModel.primitives.empty();
}

} // namespace westgate
