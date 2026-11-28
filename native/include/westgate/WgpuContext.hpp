#pragma once

#include <SDL3/SDL.h>
#include <cstddef>
#include <cstdint>
#include <string>
#include <webgpu/webgpu.h>
#include <webgpu/wgpu.h>

namespace westgate {

/**
 * Owns the native wgpu-native v29 instance, adapter, device, queue, surface, and depth buffer.
 * Automatically selects DX12/Vulkan on Windows, Metal on macOS, or Vulkan on Linux.
 * Also supports headless offscreen render-to-PNG verification without a window surface.
 */
class WgpuContext {
 public:
  bool init(SDL_Window* window, uint32_t width, uint32_t height, std::string* err = nullptr);
  bool initOffscreen(uint32_t width, uint32_t height, std::string* err = nullptr);
  bool saveOffscreenPng(const std::string& path, std::string* err = nullptr) const;
  void resize(uint32_t width, uint32_t height);
  void reconfigureSurface(bool forceRecreateDepth = false);
  void setVsync(bool vsync);
  bool vsync() const { return vsync_; }
  void shutdown();

  bool isOffscreen() const { return offscreenView_ != nullptr && surface_ == nullptr; }
  WGPUInstance instance() const { return instance_; }
  WGPUDevice device() const { return device_; }
  WGPUQueue queue() const { return queue_; }
  WGPUSurface surface() const { return surface_; }
  WGPUTextureView offscreenView() const { return offscreenView_; }
  WGPUTextureFormat surfaceFormat() const { return surfaceFormat_; }
  WGPUTextureFormat depthFormat() const { return WGPUTextureFormat_Depth32Float; }
  WGPUTextureView depthView() const { return depthView_; }
  uint32_t width() const { return width_; }
  uint32_t height() const { return height_; }
  const std::string& adapterName() const { return adapterName_; }

 private:
  void recreateDepthBuffer();

  WGPUInstance instance_ = nullptr;
  WGPUAdapter adapter_ = nullptr;
  WGPUDevice device_ = nullptr;
  WGPUQueue queue_ = nullptr;
  WGPUSurface surface_ = nullptr;
  WGPUTexture offscreenTexture_ = nullptr;
  WGPUTextureView offscreenView_ = nullptr;
  WGPUTexture depthTexture_ = nullptr;
  WGPUTextureView depthView_ = nullptr;
  WGPUTextureFormat surfaceFormat_ = WGPUTextureFormat_BGRA8Unorm;
  WGPUSurfaceConfiguration surfaceConfig_{};
  uint32_t width_ = 1280;
  uint32_t height_ = 720;
  bool vsync_ = true;
  std::string adapterName_ = "Unknown GPU";
};

} // namespace westgate
