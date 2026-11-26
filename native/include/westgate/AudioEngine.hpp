#pragma once
#include <atomic>
#include <cstdint>
#include <vector>

namespace westgate {

class AudioEngine {
public:
  AudioEngine() = default;
  virtual ~AudioEngine();

  AudioEngine(const AudioEngine&) = delete;
  AudioEngine& operator=(const AudioEngine&) = delete;

  bool init();
  void shutdown();

  // Triggered by PlayerController footstep cadence (click-free raised-cosine envelope).
  virtual void playFootstep(float intensity = 0.7f, bool inWater = false);

  // Triggered by melee hits in the Iron Pit or world combat.
  virtual void playImpact(float strength = 0.8f);

  // Triggered by firearms (suppressed crisp thwip vs loud gunshot crack).
  virtual void playGunshot(bool suppressed, float pitch = 1.0f);

  // Triggered by contract/race/shop payouts.
  virtual void playCashChime();

  // Triggered by nearby pursuing police cruiser siren.
  virtual void playSirenPulse();

  bool initialized() const { return initialized_; }

private:
  struct ActiveGrain {
    double phase = 0.0;
    double duration = 0.1;
    double freq = 140.0;
    double endFreq = 60.0;
    float gain = 0.25f;
    float noiseMix = 0.35f;
    uint32_t rng = 0x1234567u;
  };

  void pushGrain(const ActiveGrain& g);
  void mixSamples(float* output, uint32_t frameCount);
  static void dataCallback(void* device, void* output, const void* input, uint32_t frameCount);

  struct Impl;
  Impl* impl_ = nullptr;
  bool initialized_ = false;
  std::atomic<uint32_t> writeIdx_{0};
  std::vector<ActiveGrain> grains_;
  double sampleRate_ = 48000.0;
};

} // namespace westgate
