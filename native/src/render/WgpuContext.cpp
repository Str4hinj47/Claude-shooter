#include "westgate/WgpuContext.hpp"
#include "imgui_impl_wgpu.h"
#include <cstdio>
#include <vector>

#if defined(SDL_PLATFORM_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN 1
#endif
#include <windows.h>
#endif

namespace westgate {

namespace {

void onRequestAdapter(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView msg, void* ud1, void*) {
  if (status != WGPURequestAdapterStatus_Success) {
    std::fprintf(stderr, "wgpuInstanceRequestAdapter failed: %.*s\n", static_cast<int>(msg.length), msg.data ? msg.data : "");
    return;
  }
  *static_cast<WGPUAdapter*>(ud1) = adapter;
}

void onRequestDevice(WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView msg, void* ud1, void*) {
  if (status != WGPURequestDeviceStatus_Success) {
    std::fprintf(stderr, "wgpuAdapterRequestDevice failed: %.*s\n", static_cast<int>(msg.length), msg.data ? msg.data : "");
    return;
  }
  *static_cast<WGPUDevice*>(ud1) = device;
}

WGPUSurface createSurfaceForSdlWindow(WGPUInstance instance, SDL_Window* window) {
  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  ImGui_ImplWGPU_CreateSurfaceInfo info{};
  info.Instance = instance;
#if defined(SDL_PLATFORM_WIN32)
  info.System = "win32";
  info.RawWindow = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr);
  info.RawInstance = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_INSTANCE_POINTER, nullptr);
  if (!info.RawInstance) {
    info.RawInstance = reinterpret_cast<void*>(::GetModuleHandle(nullptr));
  }
#elif defined(SDL_PLATFORM_MACOS)
  info.System = "cocoa";
  info.RawWindow = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_COCOA_WINDOW_POINTER, nullptr);
#elif defined(SDL_PLATFORM_LINUX)
  const char* drv = SDL_GetCurrentVideoDriver();
  if (drv && SDL_strcmp(drv, "wayland") == 0) {
    info.System = "wayland";
    info.RawDisplay = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER, nullptr);
    info.RawSurface = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WAYLAND_SURFACE_POINTER, nullptr);
  } else {
    info.System = "x11";
    info.RawWindow = reinterpret_cast<void*>(static_cast<uintptr_t>(SDL_GetNumberProperty(props, SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0)));
    info.RawDisplay = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_X11_DISPLAY_POINTER, nullptr);
  }
#endif
  return ImGui_ImplWGPU_CreateWGPUSurfaceHelper(&info);
}

WGPUTextureFormat selectSurfaceFormat(const WGPUSurfaceCapabilities& caps) {
  const WGPUTextureFormat preferred[] = {
    WGPUTextureFormat_BGRA8Unorm,
    WGPUTextureFormat_RGBA8Unorm,
    WGPUTextureFormat_BGRA8UnormSrgb,
    WGPUTextureFormat_RGBA8UnormSrgb,
  };
  for (WGPUTextureFormat f : preferred) {
    for (size_t i = 0; i < caps.formatCount; ++i) {
      if (caps.formats[i] == f) return f;
    }
  }
  return caps.formatCount > 0 ? caps.formats[0] : WGPUTextureFormat_BGRA8Unorm;
}

} // namespace

bool WgpuContext::init(SDL_Window* window, uint32_t width, uint32_t height, std::string* err) {
  width_ = width > 0 ? width : 1280;
  height_ = height > 0 ? height : 720;

  WGPUInstanceDescriptor instDesc = WGPU_INSTANCE_DESCRIPTOR_INIT;
  WGPUInstanceFeatureName timedWaitAny = WGPUInstanceFeatureName_TimedWaitAny;
  instDesc.requiredFeatureCount = 1;
  instDesc.requiredFeatures = &timedWaitAny;
  instance_ = wgpuCreateInstance(&instDesc);
  if (!instance_) {
    if (err) *err = "wgpuCreateInstance failed";
    return false;
  }

  wgpuSetLogCallback(
    [](WGPULogLevel level, WGPUStringView msg, void*) {
      if (level <= WGPULogLevel_Warn) {
        std::fprintf(stderr, "[wgpu] %.*s\n", static_cast<int>(msg.length), msg.data ? msg.data : "");
      }
    },
    nullptr
  );
  wgpuSetLogLevel(WGPULogLevel_Warn);

  surface_ = createSurfaceForSdlWindow(instance_, window);
  if (!surface_) {
    if (err) *err = "createSurfaceForSdlWindow failed";
    return false;
  }

  WGPURequestAdapterOptions adapterOpts = WGPU_REQUEST_ADAPTER_OPTIONS_INIT;
  adapterOpts.compatibleSurface = surface_;
  adapterOpts.powerPreference = WGPUPowerPreference_HighPerformance;

  WGPURequestAdapterCallbackInfo adapterCb{};
  adapterCb.mode = WGPUCallbackMode_WaitAnyOnly;
  adapterCb.callback = onRequestAdapter;
  adapterCb.userdata1 = &adapter_;
  wgpuInstanceRequestAdapter(instance_, &adapterOpts, adapterCb);
  if (!adapter_) {
    if (err) *err = "No compatible WebGPU/DX12/Vulkan GPU adapter found";
    return false;
  }

  WGPUAdapterInfo info = WGPU_ADAPTER_INFO_INIT;
  if (wgpuAdapterGetInfo(adapter_, &info) == WGPUStatus_Success) {
    if (info.device.data && info.device.length > 0) {
      adapterName_.assign(info.device.data, info.device.length);
    }
    wgpuAdapterInfoFreeMembers(info);
  }

  WGPURequestDeviceCallbackInfo deviceCb{};
  deviceCb.mode = WGPUCallbackMode_WaitAnyOnly;
  deviceCb.callback = onRequestDevice;
  deviceCb.userdata1 = &device_;
  WGPUDeviceDescriptor devDesc = WGPU_DEVICE_DESCRIPTOR_INIT;
  wgpuAdapterRequestDevice(adapter_, &devDesc, deviceCb);
  if (!device_) {
    if (err) *err = "wgpuAdapterRequestDevice failed";
    return false;
  }

  queue_ = wgpuDeviceGetQueue(device_);

  WGPUSurfaceCapabilities caps = WGPU_SURFACE_CAPABILITIES_INIT;
  wgpuSurfaceGetCapabilities(surface_, adapter_, &caps);
  surfaceFormat_ = selectSurfaceFormat(caps);
  wgpuSurfaceCapabilitiesFreeMembers(caps);

  surfaceConfig_ = WGPU_SURFACE_CONFIGURATION_INIT;
  surfaceConfig_.device = device_;
  surfaceConfig_.format = surfaceFormat_;
  surfaceConfig_.usage = WGPUTextureUsage_RenderAttachment;
  surfaceConfig_.width = width_;
  surfaceConfig_.height = height_;
  surfaceConfig_.presentMode = WGPUPresentMode_Fifo;
  surfaceConfig_.alphaMode = WGPUCompositeAlphaMode_Auto;
  wgpuSurfaceConfigure(surface_, &surfaceConfig_);

  recreateDepthBuffer();
  return true;
}

void WgpuContext::recreateDepthBuffer() {
  if (depthView_) {
    wgpuTextureViewRelease(depthView_);
    depthView_ = nullptr;
  }
  if (depthTexture_) {
    wgpuTextureRelease(depthTexture_);
    depthTexture_ = nullptr;
  }
  if (!device_ || width_ == 0 || height_ == 0) return;

  WGPUTextureDescriptor td = WGPU_TEXTURE_DESCRIPTOR_INIT;
  td.usage = WGPUTextureUsage_RenderAttachment;
  td.dimension = WGPUTextureDimension_2D;
  td.size = {width_, height_, 1};
  td.format = depthFormat();
  td.mipLevelCount = 1;
  td.sampleCount = 1;
  depthTexture_ = wgpuDeviceCreateTexture(device_, &td);

  WGPUTextureViewDescriptor tvd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
  tvd.format = depthFormat();
  tvd.dimension = WGPUTextureViewDimension_2D;
  tvd.mipLevelCount = 1;
  tvd.arrayLayerCount = 1;
  tvd.aspect = WGPUTextureAspect_DepthOnly;
  depthView_ = wgpuTextureCreateView(depthTexture_, &tvd);
}

void WgpuContext::resize(uint32_t width, uint32_t height) {
  if (width == 0 || height == 0) return;
  if (width == width_ && height == height_) return;
  width_ = width;
  height_ = height;
  surfaceConfig_.width = width_;
  surfaceConfig_.height = height_;
  wgpuSurfaceConfigure(surface_, &surfaceConfig_);
  recreateDepthBuffer();
}

void WgpuContext::reconfigureSurface() {
  if (!surface_ || !device_ || width_ == 0 || height_ == 0) return;
  surfaceConfig_.width = width_;
  surfaceConfig_.height = height_;
  wgpuSurfaceConfigure(surface_, &surfaceConfig_);
  recreateDepthBuffer();
}

void WgpuContext::shutdown() {
  if (depthView_) {
    wgpuTextureViewRelease(depthView_);
    depthView_ = nullptr;
  }
  if (depthTexture_) {
    wgpuTextureRelease(depthTexture_);
    depthTexture_ = nullptr;
  }
  if (surface_) {
    wgpuSurfaceUnconfigure(surface_);
    wgpuSurfaceRelease(surface_);
    surface_ = nullptr;
  }
  if (queue_) {
    wgpuQueueRelease(queue_);
    queue_ = nullptr;
  }
  if (device_) {
    wgpuDeviceRelease(device_);
    device_ = nullptr;
  }
  if (adapter_) {
    wgpuAdapterRelease(adapter_);
    adapter_ = nullptr;
  }
  if (instance_) {
    wgpuInstanceRelease(instance_);
    instance_ = nullptr;
  }
}

} // namespace westgate
