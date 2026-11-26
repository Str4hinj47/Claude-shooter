#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include "westgate/AudioEngine.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>

#if defined(__has_include)
#if __has_include("miniaudio.h")
#define WESTGATE_HAS_MINIAUDIO 1
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#endif
#endif

namespace westgate {

struct AudioEngine::Impl {
#ifdef WESTGATE_HAS_MINIAUDIO
  ma_device device{};
#endif
  bool deviceStarted = false;
};

AudioEngine::~AudioEngine() {
  shutdown();
}

void AudioEngine::dataCallback(void* rawDevice, void* output, const void* /*input*/, uint32_t frameCount) {
#ifdef WESTGATE_HAS_MINIAUDIO
  auto* dev = static_cast<ma_device*>(rawDevice);
  auto* self = static_cast<AudioEngine*>(dev->pUserData);
  if (self) self->mixSamples(static_cast<float*>(output), frameCount);
#else
  (void)rawDevice;
  std::memset(output, 0, frameCount * 2 * sizeof(float));
#endif
}

bool AudioEngine::init() {
  if (initialized_) return true;
  grains_.resize(24);
  for (auto& g : grains_) g.phase = g.duration + 1.0;

  impl_ = new Impl();
#ifdef WESTGATE_HAS_MINIAUDIO
  ma_device_config cfg = ma_device_config_init(ma_device_type_playback);
  cfg.playback.format = ma_format_f32;
  cfg.playback.channels = 2;
  cfg.sampleRate = 48000;
  cfg.dataCallback = reinterpret_cast<ma_device_data_proc>(&AudioEngine::dataCallback);
  cfg.pUserData = this;

  if (ma_device_init(nullptr, &cfg, &impl_->device) == MA_SUCCESS) {
    sampleRate_ = static_cast<double>(impl_->device.sampleRate);
    if (ma_device_start(&impl_->device) == MA_SUCCESS) {
      impl_->deviceStarted = true;
    } else {
      ma_device_uninit(&impl_->device);
    }
  }
#endif
  initialized_ = true;
  return true;
}

void AudioEngine::shutdown() {
  if (!impl_) return;
#ifdef WESTGATE_HAS_MINIAUDIO
  if (impl_->deviceStarted) {
    ma_device_uninit(&impl_->device);
    impl_->deviceStarted = false;
  }
#endif
  delete impl_;
  impl_ = nullptr;
  initialized_ = false;
}

void AudioEngine::pushGrain(const ActiveGrain& g) {
  if (!initialized_ || grains_.empty()) return;
  const uint32_t idx = writeIdx_.fetch_add(1, std::memory_order_relaxed) % static_cast<uint32_t>(grains_.size());
  grains_[idx] = g;
}

void AudioEngine::playFootstep(float intensity, bool inWater) {
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = inWater ? 0.14 : 0.085;
  g.freq = inWater ? 260.0 : 145.0;
  g.endFreq = inWater ? 110.0 : 58.0;
  g.gain = std::clamp(intensity, 0.2f, 1.0f) * (inWater ? 0.18f : 0.22f);
  g.noiseMix = inWater ? 0.65f : 0.28f;
  g.rng = static_cast<uint32_t>(writeIdx_.load(std::memory_order_relaxed) * 2654435761u + 17u);
  pushGrain(g);
}

void AudioEngine::playImpact(float strength) {
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = 0.125;
  g.freq = 185.0;
  g.endFreq = 46.0;
  g.gain = std::clamp(strength, 0.25f, 1.3f) * 0.34f;
  g.noiseMix = 0.42f;
  g.rng = static_cast<uint32_t>(writeIdx_.load(std::memory_order_relaxed) * 2246822519u + 91u);
  pushGrain(g);
}

void AudioEngine::playGunshot(bool suppressed, float pitch) {
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = suppressed ? 0.075 : 0.165;
  g.freq = (suppressed ? 420.0 : 280.0) * static_cast<double>(pitch);
  g.endFreq = suppressed ? 95.0 : 48.0;
  g.gain = suppressed ? 0.22f : 0.40f;
  g.noiseMix = suppressed ? 0.52f : 0.72f;
  g.rng = static_cast<uint32_t>(writeIdx_.load(std::memory_order_relaxed) * 3266489917u + 37u);
  pushGrain(g);
}

void AudioEngine::playCashChime() {
  ActiveGrain g1;
  g1.phase = 0.0;
  g1.duration = 0.18;
  g1.freq = 880.0;
  g1.endFreq = 1320.0;
  g1.gain = 0.18f;
  g1.noiseMix = 0.0f;
  pushGrain(g1);
}

void AudioEngine::playSirenPulse() {
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = 0.24;
  g.freq = 640.0;
  g.endFreq = 920.0;
  g.gain = 0.10f;
  g.noiseMix = 0.02f;
  pushGrain(g);
}

void AudioEngine::mixSamples(float* output, uint32_t frameCount) {
  const double dt = 1.0 / std::max(8000.0, sampleRate_);
  for (uint32_t i = 0; i < frameCount; ++i) {
    float sample = 0.0f;
    for (auto& g : grains_) {
      if (g.phase >= g.duration) continue;
      const double u = g.phase / g.duration;
      const double env = 0.5 * (1.0 - std::cos(2.0 * 3.14159265358979 * u)) * std::exp(-u * 3.2);
      const double freq = g.freq + (g.endFreq - g.freq) * u;
      const double tone = std::sin(2.0 * 3.14159265358979 * freq * g.phase);

      g.rng = g.rng * 1664525u + 1013904223u;
      const float white = (static_cast<float>((g.rng >> 8) & 0xFFFF) / 32768.0f) - 1.0f;
      const float mixed = static_cast<float>(tone) * (1.0f - g.noiseMix) + white * g.noiseMix;

      sample += mixed * static_cast<float>(env) * g.gain;
      g.phase += dt;
    }
    sample = std::tanh(sample);
    output[i * 2 + 0] = sample;
    output[i * 2 + 1] = sample;
  }
}

} // namespace westgate
