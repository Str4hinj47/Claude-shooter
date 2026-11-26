#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

#include "westgate/AudioEngine.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <mutex>

namespace westgate {

namespace {

struct StepVoice {
  bool active = false;
  bool isWater = false;
  float time = 0.0f;
  float duration = 0.085f;
  float intensity = 0.6f;
  float freqStart = 115.0f;
  float freqEnd = 44.0f;
  float phase = 0.0f;
  float lpState = 0.0f;
  uint32_t rng = 0x12345678u;
};

float nextRand(uint32_t& s) {
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  return (static_cast<float>(s & 0xFFFFu) / 32767.5f) - 1.0f;
}

} // namespace

struct AudioEngine::Impl {
  ma_device device{};
  bool initialized = false;
  uint32_t sampleRate = 48000;
  std::mutex voiceMutex;
  std::array<StepVoice, 8> voices{};
  uint32_t nextVoice = 0;

  static void dataCallback(ma_device* dev, void* output, const void* /*input*/, ma_uint32 frameCount) {
    auto* self = static_cast<AudioEngine*>(dev->pUserData);
    float* out = static_cast<float*>(output);
    const ma_uint32 ch = dev->playback.channels;
    std::fill(out, out + static_cast<size_t>(frameCount) * ch, 0.0f);
    if (!self || self->muted_.load(std::memory_order_relaxed)) return;

    auto* impl = self->impl_.get();
    std::lock_guard<std::mutex> lock(impl->voiceMutex);
    const float dt = 1.0f / static_cast<float>(impl->sampleRate);
    constexpr float kTwoPi = 6.283185307f;
    constexpr float kPi = 3.141592653f;

    for (auto& v : impl->voices) {
      if (!v.active) continue;
      for (ma_uint32 f = 0; f < frameCount; ++f) {
        if (v.time >= v.duration) {
          v.active = false;
          break;
        }
        const float u = v.time / v.duration;
        // Smooth raised-cosine attack (first 18%) + exponential tail: guarantees zero click!
        const float attack = u < 0.18f ? 0.5f * (1.0f - std::cos(kPi * (u / 0.18f))) : 1.0f;
        const float decay = std::exp(-u * 4.8f);
        const float env = attack * decay;

        const float freq = v.freqStart + (v.freqEnd - v.freqStart) * std::min(1.0f, u * 1.4f);
        v.phase += kTwoPi * freq * dt;
        if (v.phase > kTwoPi) v.phase -= kTwoPi;

        const float heel = std::sin(v.phase) * 0.45f;
        const float rawNoise = nextRand(v.rng);
        const float cutoff = v.isWater ? 0.28f : 0.11f;
        v.lpState += cutoff * (rawNoise - v.lpState);

        const float sample = (heel * (v.isWater ? 0.25f : 0.7f) + v.lpState * 0.65f) * env * (0.22f * v.intensity);
        for (ma_uint32 c = 0; c < ch; ++c) {
          out[f * ch + c] += sample;
        }
        v.time += dt;
      }
    }
  }
};

AudioEngine::AudioEngine() : impl_(std::make_unique<Impl>()) {}

AudioEngine::~AudioEngine() { shutdown(); }

bool AudioEngine::init() {
  if (impl_->initialized) return true;
  ma_device_config cfg = ma_device_config_init(ma_device_type_playback);
  cfg.playback.format = ma_format_f32;
  cfg.playback.channels = 2;
  cfg.sampleRate = 48000;
  cfg.dataCallback = &Impl::dataCallback;
  cfg.pUserData = this;

  if (ma_device_init(nullptr, &cfg, &impl_->device) != MA_SUCCESS) {
    return false;
  }
  impl_->sampleRate = impl_->device.sampleRate;
  if (ma_device_start(&impl_->device) != MA_SUCCESS) {
    ma_device_uninit(&impl_->device);
    return false;
  }
  impl_->initialized = true;
  return true;
}

void AudioEngine::shutdown() {
  if (!impl_->initialized) return;
  ma_device_uninit(&impl_->device);
  impl_->initialized = false;
}

void AudioEngine::playFootstep(float intensity, bool isWater) {
  if (!impl_->initialized || muted_.load(std::memory_order_relaxed)) return;
  std::lock_guard<std::mutex> lock(impl_->voiceMutex);
  StepVoice& v = impl_->voices[impl_->nextVoice++ % impl_->voices.size()];
  v.active = true;
  v.isWater = isWater;
  v.time = 0.0f;
  v.duration = isWater ? 0.14f : 0.085f;
  v.intensity = std::clamp(intensity, 0.2f, 1.15f);
  const float jitter = 0.94f + 0.12f * (static_cast<float>((impl_->nextVoice * 37u) % 100u) / 100.0f);
  v.freqStart = (isWater ? 140.0f : 114.0f) * jitter;
  v.freqEnd = (isWater ? 52.0f : 44.0f) * jitter;
  v.phase = 0.0f;
  v.lpState = 0.0f;
  v.rng = 0x9E3779B9u ^ (impl_->nextVoice * 2654435761u);
}

void AudioEngine::setMuted(bool muted) {
  muted_.store(muted, std::memory_order_relaxed);
}

} // namespace westgate
