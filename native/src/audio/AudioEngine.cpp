#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include "westgate/AudioEngine.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>

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
  grains_.resize(40);
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

void AudioEngine::setListener(const glm::vec3& pos, float yawRad) {
  listenerX_.store(pos.x, std::memory_order_relaxed);
  listenerY_.store(pos.y, std::memory_order_relaxed);
  listenerZ_.store(pos.z, std::memory_order_relaxed);
  listenerYaw_.store(yawRad, std::memory_order_relaxed);
}

void AudioEngine::setAssetsRoot(const std::string& publicRoot) {
  std::lock_guard<std::mutex> lk(streamMutex_);
  assetsRoot_ = publicRoot;
}

bool AudioEngine::decodeAudioFileToStereo(const std::string& fullPath, uint32_t targetSampleRate, std::vector<float>& outStereoFrames) {
  outStereoFrames.clear();
#ifdef WESTGATE_HAS_MINIAUDIO
  if (!std::filesystem::exists(fullPath)) return false;
  ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 2, targetSampleRate > 0 ? targetSampleRate : 48000u);
  ma_decoder dec{};
  if (ma_decoder_init_file(fullPath.c_str(), &dcfg, &dec) != MA_SUCCESS) {
    return false;
  }
  constexpr ma_uint64 kChunkFrames = 4096;
  std::vector<float> temp(kChunkFrames * 2);
  while (true) {
    ma_uint64 framesRead = 0;
    const ma_result r = ma_decoder_read_pcm_frames(&dec, temp.data(), kChunkFrames, &framesRead);
    if (framesRead > 0) {
      outStereoFrames.insert(outStereoFrames.end(), temp.begin(), temp.begin() + static_cast<size_t>(framesRead * 2));
    }
    if (r != MA_SUCCESS || framesRead < kChunkFrames) break;
  }
  ma_decoder_uninit(&dec);
  return !outStereoFrames.empty();
#else
  (void)fullPath;
  (void)targetSampleRate;
  return false;
#endif
}

std::shared_ptr<const AudioEngine::DecodedClip> AudioEngine::loadOrGetClip(const std::string& relPath) {
  if (relPath.empty()) return nullptr;
  std::string rootCopy;
  {
    std::lock_guard<std::mutex> lk(streamMutex_);
    auto it = clipCache_.find(relPath);
    if (it != clipCache_.end()) return it->second;
    rootCopy = assetsRoot_;
  }

  std::filesystem::path fullPath = relPath;
  if (!std::filesystem::exists(fullPath) && !rootCopy.empty()) {
    fullPath = std::filesystem::path(rootCopy) / relPath;
  }
  if (!std::filesystem::exists(fullPath)) {
    fullPath = std::filesystem::path("public") / relPath;
  }

  auto decoded = std::make_shared<DecodedClip>();
  const uint32_t sr = static_cast<uint32_t>(std::max(8000.0, sampleRate_));
  if (!decodeAudioFileToStereo(fullPath.string(), sr, decoded->stereoSamples)) {
    return nullptr;
  }

  std::lock_guard<std::mutex> lk(streamMutex_);
  if (clipCache_.size() > 64) {
    clipCache_.clear();
  }
  clipCache_[relPath] = decoded;
  return decoded;
}

bool AudioEngine::playVoiceClip(const std::string& relPath, float gain) {
  auto clip = loadOrGetClip(relPath);
  if (!clip) return false;
  std::lock_guard<std::mutex> lk(streamMutex_);
  activeVoice_ = std::move(clip);
  voiceFrameCursor_ = 0;
  voiceGain_ = std::clamp(gain, 0.0f, 1.5f);
  voicePan_ = 0.0f;
  return true;
}

bool AudioEngine::playSpatialComms(const std::string& relPath, const glm::vec3& worldPos, float gain) {
  float att = 1.0f, pan = 0.0f;
  computeSpatial(worldPos, 72.0f, att, pan);
  if (att <= 0.02f) return false;
  auto clip = loadOrGetClip(relPath);
  if (!clip) return false;
  std::lock_guard<std::mutex> lk(streamMutex_);
  activeComms_ = std::move(clip);
  commsFrameCursor_ = 0;
  commsGain_ = std::clamp(gain * att, 0.0f, 1.4f);
  commsPan_ = pan;
  return true;
}

bool AudioEngine::playMusicTrack(const std::string& relPath, float gain, bool loop) {
  {
    std::lock_guard<std::mutex> lk(streamMutex_);
    if (activeMusic_ && activeMusicPath_ == relPath) {
      musicGain_ = std::clamp(gain, 0.0f, 1.0f);
      musicLoop_ = loop;
      return true;
    }
  }
  auto clip = loadOrGetClip(relPath);
  if (!clip) return false;
  std::lock_guard<std::mutex> lk(streamMutex_);
  activeMusic_ = std::move(clip);
  activeMusicPath_ = relPath;
  musicFrameCursor_ = 0;
  musicGain_ = std::clamp(gain, 0.0f, 1.0f);
  musicLoop_ = loop;
  return true;
}

void AudioEngine::stopMusicTrack() {
  std::lock_guard<std::mutex> lk(streamMutex_);
  activeMusic_.reset();
  activeMusicPath_.clear();
  musicFrameCursor_ = 0;
}

bool AudioEngine::isVoicePlaying() const {
  std::lock_guard<std::mutex> lk(streamMutex_);
  return activeVoice_ != nullptr && voiceFrameCursor_ < activeVoice_->frameCount();
}

void AudioEngine::computeSpatial(const glm::vec3& worldPos, float maxDist, float& outGain, float& outPan) const {
  const glm::vec3 lp(
    listenerX_.load(std::memory_order_relaxed),
    listenerY_.load(std::memory_order_relaxed),
    listenerZ_.load(std::memory_order_relaxed)
  );
  const glm::vec3 d = worldPos - lp;
  const float dist = glm::length(d);
  if (dist >= maxDist) {
    outGain = 0.0f;
    outPan = 0.0f;
    return;
  }
  const float norm = dist / std::max(1.0f, maxDist);
  outGain = std::clamp((1.0f - norm) * (1.0f - norm), 0.04f, 1.0f);
  if (dist < 0.75f) {
    outPan = 0.0f;
    return;
  }
  const float yaw = listenerYaw_.load(std::memory_order_relaxed);
  // Camera right vector in XZ plane: (cos(yaw), 0, -sin(yaw))
  const glm::vec2 rightXZ(std::cos(yaw), -std::sin(yaw));
  const glm::vec2 dirXZ = glm::vec2(d.x, d.z) / std::max(0.01f, std::hypot(d.x, d.z));
  outPan = std::clamp(glm::dot(rightXZ, dirXZ), -1.0f, 1.0f);
}

void AudioEngine::pushGrain(const ActiveGrain& g) {
  if (!initialized_ || grains_.empty() || g.gain <= 0.002f) return;
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
  g.pan = 0.0f;
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
  g.pan = 0.0f;
  g.rng = static_cast<uint32_t>(writeIdx_.load(std::memory_order_relaxed) * 2246822519u + 91u);
  pushGrain(g);
}

void AudioEngine::playSpatialImpact(const glm::vec3& worldPos, float strength) {
  float att = 1.0f, pan = 0.0f;
  computeSpatial(worldPos, 48.0f, att, pan);
  if (att <= 0.01f) return;
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = 0.125;
  g.freq = 185.0;
  g.endFreq = 46.0;
  g.gain = std::clamp(strength, 0.25f, 1.3f) * 0.36f * att;
  g.noiseMix = 0.42f;
  g.pan = pan;
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
  g.pan = 0.0f;
  g.rng = static_cast<uint32_t>(writeIdx_.load(std::memory_order_relaxed) * 3266489917u + 37u);
  pushGrain(g);
}

void AudioEngine::playSpatialGunshot(const glm::vec3& worldPos, bool suppressed, float pitch) {
  float att = 1.0f, pan = 0.0f;
  computeSpatial(worldPos, 110.0f, att, pan);
  if (att <= 0.01f) return;
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = suppressed ? 0.075 : 0.165;
  g.freq = (suppressed ? 420.0 : 280.0) * static_cast<double>(pitch);
  g.endFreq = suppressed ? 95.0 : 48.0;
  g.gain = (suppressed ? 0.22f : 0.40f) * att;
  g.noiseMix = suppressed ? 0.52f : 0.72f;
  g.pan = pan;
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

void AudioEngine::playSpatialSiren(const glm::vec3& worldPos) {
  float att = 1.0f, pan = 0.0f;
  computeSpatial(worldPos, 140.0f, att, pan);
  if (att <= 0.01f) return;
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = 0.26;
  g.freq = 640.0;
  g.endFreq = 930.0;
  g.gain = 0.14f * att;
  g.noiseMix = 0.02f;
  g.pan = pan;
  pushGrain(g);
}

void AudioEngine::playPitBell(bool roundEnd) {
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = roundEnd ? 0.65 : 0.48;
  g.freq = roundEnd ? 980.0 : 1140.0;
  g.endFreq = roundEnd ? 955.0 : 1120.0;
  g.gain = 0.26f;
  g.noiseMix = 0.04f;
  pushGrain(g);
}

void AudioEngine::playCrowdCheer(float intensity) {
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = 0.72;
  g.freq = 320.0;
  g.endFreq = 180.0;
  g.gain = std::clamp(intensity, 0.2f, 1.0f) * 0.22f;
  g.noiseMix = 0.88f;
  g.rng = static_cast<uint32_t>(writeIdx_.load(std::memory_order_relaxed) * 1597334677u + 53u);
  pushGrain(g);
}

void AudioEngine::playVehicleCrash(float strength) {
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = 0.24;
  g.freq = 140.0;
  g.endFreq = 36.0;
  g.gain = std::clamp(strength, 0.2f, 1.2f) * 0.34f;
  g.noiseMix = 0.68f;
  g.rng = static_cast<uint32_t>(writeIdx_.load(std::memory_order_relaxed) * 2869860233u + 19u);
  pushGrain(g);
}

void AudioEngine::playExplosion(const glm::vec3& worldPos) {
  float att = 1.0f, pan = 0.0f;
  computeSpatial(worldPos, 150.0f, att, pan);
  if (att <= 0.01f) return;
  ActiveGrain g;
  g.phase = 0.0;
  g.duration = 0.55;
  g.freq = 120.0;
  g.endFreq = 26.0;
  g.gain = 0.48f * att;
  g.noiseMix = 0.80f;
  g.pan = pan;
  g.rng = static_cast<uint32_t>(writeIdx_.load(std::memory_order_relaxed) * 40503u + 7u);
  pushGrain(g);
}

void AudioEngine::setEngineState(bool inVehicle, float speedRatio) {
  engineGain_.store(inVehicle ? 0.075f : 0.0f, std::memory_order_relaxed);
  engineSpeedRatio_.store(std::clamp(speedRatio, 0.0f, 1.5f), std::memory_order_relaxed);
}

void AudioEngine::mixSamples(float* output, uint32_t frameCount) {
  const double dt = 1.0 / std::max(8000.0, sampleRate_);
  const float engGain = engineGain_.load(std::memory_order_relaxed);
  const float engSpd = engineSpeedRatio_.load(std::memory_order_relaxed);
  const double engFreqA = 34.0 + static_cast<double>(engSpd) * 76.0;
  const double engFreqB = engFreqA * 1.98;

  // Snapshot active MP3 streams under non-blocking try_lock so the audio callback never stalls
  std::shared_ptr<const DecodedClip> voiceRef, commsRef, musicRef;
  size_t vCur = 0, cCur = 0, mCur = 0;
  float vGain = 0.0f, cGain = 0.0f, cPan = 0.0f, mGain = 0.0f;
  bool mLoop = true;
  const bool haveStreamLock = streamMutex_.try_lock();
  if (haveStreamLock) {
    voiceRef = activeVoice_; vCur = voiceFrameCursor_; vGain = voiceGain_;
    commsRef = activeComms_; cCur = commsFrameCursor_; cGain = commsGain_; cPan = commsPan_;
    musicRef = activeMusic_; mCur = musicFrameCursor_; mGain = musicGain_; mLoop = musicLoop_;
  }

  for (uint32_t i = 0; i < frameCount; ++i) {
    float left = 0.0f;
    float right = 0.0f;

    bool voiceActiveThisFrame = false;
    if (voiceRef && vCur < voiceRef->frameCount()) {
      left += voiceRef->stereoSamples[vCur * 2 + 0] * vGain;
      right += voiceRef->stereoSamples[vCur * 2 + 1] * vGain;
      ++vCur;
      voiceActiveThisFrame = true;
    }
    if (commsRef && cCur < commsRef->frameCount()) {
      const float mono = 0.5f * (commsRef->stereoSamples[cCur * 2 + 0] + commsRef->stereoSamples[cCur * 2 + 1]) * cGain;
      const float ang = (std::clamp(cPan, -1.0f, 1.0f) + 1.0f) * 0.78539816f;
      left += mono * std::cos(ang);
      right += mono * std::sin(ang);
      ++cCur;
      voiceActiveThisFrame = true;
    }
    if (musicRef && musicRef->frameCount() > 0) {
      if (mCur >= musicRef->frameCount() && mLoop) mCur = 0;
      if (mCur < musicRef->frameCount()) {
        const float duck = voiceActiveThisFrame ? 0.42f : 1.0f;
        left += musicRef->stereoSamples[mCur * 2 + 0] * mGain * duck;
        right += musicRef->stereoSamples[mCur * 2 + 1] * mGain * duck;
        ++mCur;
      }
    }

    if (engGain > 0.001f) {
      enginePhaseA_ += dt * engFreqA;
      enginePhaseB_ += dt * engFreqB;
      if (enginePhaseA_ > 1.0) enginePhaseA_ -= std::floor(enginePhaseA_);
      if (enginePhaseB_ > 1.0) enginePhaseB_ -= std::floor(enginePhaseB_);
      const float sA = static_cast<float>(std::sin(2.0 * 3.14159265358979 * enginePhaseA_));
      const float sB = static_cast<float>(std::sin(2.0 * 3.14159265358979 * enginePhaseB_));
      const float eng = (sA * 0.68f + sB * 0.32f) * engGain;
      left += eng;
      right += eng;
    }

    for (auto& g : grains_) {
      if (g.phase >= g.duration) continue;
      const double u = g.phase / g.duration;
      const double env = 0.5 * (1.0 - std::cos(2.0 * 3.14159265358979 * u)) * std::exp(-u * 3.2);
      const double freq = g.freq + (g.endFreq - g.freq) * u;
      const double tone = std::sin(2.0 * 3.14159265358979 * freq * g.phase);

      g.rng = g.rng * 1664525u + 1013904223u;
      const float white = (static_cast<float>((g.rng >> 8) & 0xFFFF) / 32768.0f) - 1.0f;
      const float mixed = static_cast<float>(tone) * (1.0f - g.noiseMix) + white * g.noiseMix;
      const float val = mixed * static_cast<float>(env) * g.gain;

      const float p = std::clamp(g.pan, -1.0f, 1.0f);
      const float ang = (p + 1.0f) * 0.78539816f; // [0 .. pi/2] equal-power pan
      left += val * std::cos(ang);
      right += val * std::sin(ang);
      g.phase += dt;
    }
    output[i * 2 + 0] = std::tanh(left);
    output[i * 2 + 1] = std::tanh(right);
  }

  if (haveStreamLock) {
    voiceFrameCursor_ = vCur;
    if (activeVoice_ && voiceFrameCursor_ >= activeVoice_->frameCount()) activeVoice_.reset();
    commsFrameCursor_ = cCur;
    if (activeComms_ && commsFrameCursor_ >= activeComms_->frameCount()) activeComms_.reset();
    musicFrameCursor_ = mCur;
    if (activeMusic_ && !musicLoop_ && musicFrameCursor_ >= activeMusic_->frameCount()) activeMusic_.reset();
    streamMutex_.unlock();
  }
}

} // namespace westgate
