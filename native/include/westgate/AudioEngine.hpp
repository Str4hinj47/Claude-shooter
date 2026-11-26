#pragma once

#include <atomic>
#include <cstdint>
#include <memory>

namespace westgate {

/**
 * Low-latency native audio engine backed by miniaudio.
 * Synthesizes click-free footsteps using raised-cosine (Hann) envelopes + low-pass filtered noise.
 */
class AudioEngine {
 public:
  AudioEngine();
  ~AudioEngine();

  AudioEngine(const AudioEngine&) = delete;
  AudioEngine& operator=(const AudioEngine&) = delete;

  bool init();
  void shutdown();

  void playFootstep(float intensity, bool isWater = false);
  void playImpact(float strength = 0.85f);
  void setMuted(bool muted);
  bool isMuted() const { return muted_.load(std::memory_order_relaxed); }

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  std::atomic<bool> muted_{false};
};

} // namespace westgate
