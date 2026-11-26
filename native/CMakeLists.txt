cmake_minimum_required(VERSION 3.24)
cmake_policy(SET CMP0091 NEW)

project(WestgateNativeEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Force consistent /MD (/MDd in Debug) across all targets on Windows MSVC (prevents LNK2038 with Jolt)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
if(WIN32)
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

option(WESTGATE_BUILD_DESKTOP "Build SDL3 + wgpu-native windowed desktop executable" ON)
option(WESTGATE_BUILD_TESTS "Build native engine unit/integration tests" ON)

include(FetchContent)

# ---------------------------------------------------------------------------
# 1. Core Dependencies (Cross-platform, zero OS windowing required)
# ---------------------------------------------------------------------------
set(USE_STATIC_MSVC_RUNTIME_LIBRARY OFF CACHE BOOL "" FORCE)
set(CPP_EXCEPTIONS_ENABLED ON CACHE BOOL "" FORCE)
set(CPP_RTTI_ENABLED ON CACHE BOOL "" FORCE)
set(ENABLE_ALL_WARNINGS OFF CACHE BOOL "" FORCE)
set(OVERRIDE_CXX_FLAGS OFF CACHE BOOL "" FORCE)
set(INTERPROCEDURAL_OPTIMIZATION OFF CACHE BOOL "" FORCE)
set(FLOATING_POINT_EXCEPTIONS_ENABLED OFF CACHE BOOL "" FORCE)
set(TARGET_UNIT_TESTS OFF CACHE BOOL "" FORCE)
set(TARGET_HELLO_WORLD OFF CACHE BOOL "" FORCE)
set(TARGET_PERFORMANCE_TEST OFF CACHE BOOL "" FORCE)
set(TARGET_SAMPLES OFF CACHE BOOL "" FORCE)
set(TARGET_VIEWER OFF CACHE BOOL "" FORCE)
set(DEBUG_RENDERER_IN_DEBUG_AND_RELEASE OFF CACHE BOOL "" FORCE)
set(PROFILER_IN_DEBUG_AND_RELEASE OFF CACHE BOOL "" FORCE)
set(JPH_USE_DX12 OFF CACHE BOOL "" FORCE)
set(JPH_USE_VK OFF CACHE BOOL "" FORCE)
set(JPH_USE_MTL OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  JoltPhysics
  URL https://codeload.github.com/jrouwe/JoltPhysics/tar.gz/refs/tags/v5.7.0
  SOURCE_SUBDIR Build
)

set(MESHOPT_BUILD_DEMO OFF CACHE BOOL "" FORCE)
set(MESHOPT_BUILD_GLTFPACK OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  meshoptimizer
  URL https://codeload.github.com/zeux/meshoptimizer/tar.gz/refs/tags/v1.3
)

FetchContent_Declare(
  cgltf
  URL https://codeload.github.com/jkuhlmann/cgltf/tar.gz/refs/tags/v1.15
)

set(GLM_BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  glm
  URL https://codeload.github.com/g-truc/glm/tar.gz/refs/tags/1.0.1
)

set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_Declare(
  nlohmann_json
  URL https://codeload.github.com/nlohmann/json/tar.gz/refs/tags/v3.11.3
)

FetchContent_Declare(
  stb
  URL https://codeload.github.com/nothings/stb/tar.gz/6b5799bae8a1fe3792691ef4b72ae26434c3e799
)

FetchContent_MakeAvailable(JoltPhysics meshoptimizer cgltf glm nlohmann_json stb)

# ---------------------------------------------------------------------------
# 2. Core Native Engine Library (westgate_core)
# ---------------------------------------------------------------------------
add_library(westgate_core STATIC
  src/core/WorldData.cpp
  src/core/GltfAssetLoader.cpp
  src/core/PhysicsWorld.cpp
  src/core/PlayerController.cpp
)

target_include_directories(westgate_core PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
  "${cgltf_SOURCE_DIR}"
  "${stb_SOURCE_DIR}"
)

target_link_libraries(westgate_core PUBLIC
  Jolt::Jolt
  meshoptimizer
  glm::glm
  nlohmann_json::nlohmann_json
)

if(MSVC)
  target_compile_options(westgate_core PRIVATE /W3 /MP)
else()
  target_compile_options(westgate_core PRIVATE -Wall -Wextra -Wno-missing-field-initializers)
endif()

# ---------------------------------------------------------------------------
# 3. Native Engine Headless Tests (westgate_tests)
# ---------------------------------------------------------------------------
if(WESTGATE_BUILD_TESTS)
  add_executable(westgate_tests tests/test_engine.cpp)
  get_filename_component(WESTGATE_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
  target_compile_definitions(westgate_tests PRIVATE
    WESTGATE_SOURCE_ROOT="${WESTGATE_REPO_ROOT}"
  )
  target_link_libraries(westgate_tests PRIVATE westgate_core)
  enable_testing()
  add_test(NAME westgate_core_tests COMMAND westgate_tests)
endif()

# ---------------------------------------------------------------------------
# 4. Desktop Windowed Engine (SDL3 + wgpu-native v29 + Dear ImGui + miniaudio)
# ---------------------------------------------------------------------------
if(WESTGATE_BUILD_DESKTOP)
  set(SDL_SHARED OFF CACHE BOOL "" FORCE)
  set(SDL_STATIC ON CACHE BOOL "" FORCE)
  set(SDL_FORCE_STATIC_VCRT OFF CACHE BOOL "" FORCE)
  set(SDL_TEST_LIBRARY OFF CACHE BOOL "" FORCE)
  set(SDL_TESTS OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(
    SDL3
    URL https://codeload.github.com/libsdl-org/SDL/tar.gz/refs/tags/release-3.4.20
  )

  FetchContent_Declare(
    imgui
    URL https://codeload.github.com/ocornut/imgui/tar.gz/0baafdcd3870bcdf5714a81ee2e4b1cc90ed134c
  )

  FetchContent_Declare(
    miniaudio
    URL https://codeload.github.com/mackron/miniaudio/tar.gz/4a5b74bef029b3592c54b6048650ee5f972c1a48
  )

  FetchContent_MakeAvailable(SDL3 imgui miniaudio)

  # Download official prebuilt wgpu-native v29.0.1.1 binary for host platform
  set(WGPU_VERSION "v29.0.1.1")
  if(WIN32)
    if(MINGW)
      set(WGPU_ARCHIVE "wgpu-windows-x86_64-gnu-release.zip")
    else()
      set(WGPU_ARCHIVE "wgpu-windows-x86_64-msvc-release.zip")
    endif()
  elseif(APPLE)
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
      set(WGPU_ARCHIVE "wgpu-macos-aarch64-release.zip")
    else()
      set(WGPU_ARCHIVE "wgpu-macos-x86_64-release.zip")
    endif()
  else()
    set(WGPU_ARCHIVE "wgpu-linux-x86_64-release.zip")
  endif()

  set(WGPU_DIR "${CMAKE_BINARY_DIR}/_deps/wgpu-native")
  set(WGPU_ZIP "${CMAKE_BINARY_DIR}/_deps/${WGPU_ARCHIVE}")
  if(NOT EXISTS "${WGPU_DIR}/include/webgpu/webgpu.h")
    file(MAKE_DIRECTORY "${WGPU_DIR}")
    message(STATUS "Downloading wgpu-native ${WGPU_VERSION} (${WGPU_ARCHIVE})...")
    file(DOWNLOAD
      "https://github.com/gfx-rs/wgpu-native/releases/download/${WGPU_VERSION}/${WGPU_ARCHIVE}"
      "${WGPU_ZIP}"
      SHOW_PROGRESS
      STATUS WGPU_DL_STATUS
    )
    list(GET WGPU_DL_STATUS 0 WGPU_DL_CODE)
    if(NOT WGPU_DL_CODE EQUAL 0)
      list(GET WGPU_DL_STATUS 1 WGPU_DL_MSG)
      message(FATAL_ERROR "Failed to download wgpu-native: ${WGPU_DL_MSG}")
    endif()
    file(ARCHIVE_EXTRACT INPUT "${WGPU_ZIP}" DESTINATION "${WGPU_DIR}")
  endif()

  add_library(wgpu_native INTERFACE)
  target_include_directories(wgpu_native INTERFACE "${WGPU_DIR}/include")
  if(WIN32)
    if(MSVC)
      target_link_libraries(wgpu_native INTERFACE "${WGPU_DIR}/lib/wgpu_native.dll.lib")
    else()
      target_link_libraries(wgpu_native INTERFACE "${WGPU_DIR}/lib/libwgpu_native.dll.a")
    endif()
  elseif(APPLE)
    target_link_libraries(wgpu_native INTERFACE "${WGPU_DIR}/lib/libwgpu_native.dylib")
  else()
    target_link_libraries(wgpu_native INTERFACE "${WGPU_DIR}/lib/libwgpu_native.so")
  endif()

  # Dear ImGui static library (SDL3 + WebGPU backend)
  add_library(imgui_sdl3_wgpu STATIC
    "${imgui_SOURCE_DIR}/imgui.cpp"
    "${imgui_SOURCE_DIR}/imgui_draw.cpp"
    "${imgui_SOURCE_DIR}/imgui_tables.cpp"
    "${imgui_SOURCE_DIR}/imgui_widgets.cpp"
    "${imgui_SOURCE_DIR}/backends/imgui_impl_sdl3.cpp"
    "${imgui_SOURCE_DIR}/backends/imgui_impl_wgpu.cpp"
  )
  target_include_directories(imgui_sdl3_wgpu PUBLIC
    "${imgui_SOURCE_DIR}"
    "${imgui_SOURCE_DIR}/backends"
  )
  target_compile_definitions(imgui_sdl3_wgpu PUBLIC IMGUI_IMPL_WEBGPU_BACKEND_WGPU=1)
  target_link_libraries(imgui_sdl3_wgpu PUBLIC SDL3::SDL3 wgpu_native)

  add_executable(westgate_engine
    src/audio/AudioEngine.cpp
    src/render/WgpuContext.cpp
    src/render/WorldRenderer.cpp
    src/app/main.cpp
  )
  target_include_directories(westgate_engine PRIVATE "${miniaudio_SOURCE_DIR}")
  target_link_libraries(westgate_engine PRIVATE
    westgate_core
    SDL3::SDL3
    wgpu_native
    imgui_sdl3_wgpu
  )

  # Stage runtime DLL, WGSL shaders, world data, and player GLB beside westgate_engine executable
  if(WIN32)
    add_custom_command(TARGET westgate_engine POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WGPU_DIR}/lib/wgpu_native.dll"
        "$<TARGET_FILE_DIR:westgate_engine>/wgpu_native.dll"
    )
  endif()

  add_custom_command(TARGET westgate_engine POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
      "${CMAKE_CURRENT_SOURCE_DIR}/assets"
      "$<TARGET_FILE_DIR:westgate_engine>/assets"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
      "${CMAKE_CURRENT_SOURCE_DIR}/shaders"
      "$<TARGET_FILE_DIR:westgate_engine>/assets/shaders"
  )
  if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../public/characters/fighter/base_body.glb")
    add_custom_command(TARGET westgate_engine POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E make_directory
        "$<TARGET_FILE_DIR:westgate_engine>/assets/characters/fighter"
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/../public/characters/fighter/base_body.glb"
        "$<TARGET_FILE_DIR:westgate_engine>/assets/characters/fighter/base_body.glb"
    )
  endif()
endif()
