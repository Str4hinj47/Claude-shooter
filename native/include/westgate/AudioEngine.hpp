#pragma once
#include <atomic>
#include <cstdint>
#include <glm/glm.hpp>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
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

  // Configure root directory containing audio/{chapters,missions,story,bosses,comms,surveillance} MP3 clips.
  void setAssetsRoot(const std::string& publicRoot);

  /** Decode an MP3/WAV file via miniaudio's built-in decoder into interleaved stereo float32 PCM. */
  static bool decodeAudioFileToStereo(const std::string& fullPath, uint32_t targetSampleRate, std::vector<float>& outStereoFrames);

  /** Play recorded story/briefing/dispatch/surveillance MP3 voiceover (ducks background music automatically). */
  virtual bool playVoiceClip(const std::string& relPath, float gain = 0.86f);

  /** Play 3D spatialized enemy squad / police comms MP3 callout (`comms_*.mp3`). */
  virtual bool playSpatialComms(const std::string& relPath, const glm::vec3& worldPos, float gain = 0.80f);

  /** Play or stop chapter/mission soundtrack MP3 (`audio/missions/ch00.mp3` .. `ch09.mp3`). */
  virtual bool playMusicTrack(const std::string& relPath, float gain = 0.24f, bool loop = true);
  virtual void stopMusicTrack();
  bool isVoicePlaying() const;

  /** Update 3D listener transform (player/camera world position + yaw in radians). */
  virtual void setListener(const glm::vec3& pos, float yawRad);

  /** Triggered by PlayerController footstep cadence (click-free raised-cosine envelope). */
  virtual void playFootstep(float intensity = 0.7f, bool inWater = false);

  /** Triggered by melee hits in the Iron Pit or world combat. */
  virtual void playImpact(float strength = 0.8f);
  virtual void playSpatialImpact(const glm::vec3& worldPos, float strength = 0.8f);

  /** Triggered by firearms (suppressed crisp thwip vs loud gunshot crack). */
  virtual void playGunshot(bool suppressed, float pitch = 1.0f);
  virtual void playSpatialGunshot(const glm::vec3& worldPos, bool suppressed, float pitch = 1.0f);

  /** Triggered by contract/race/shop payouts. */
  virtual void playCashChime();

  /** Triggered by nearby pursuing police cruiser siren. */
  virtual void playSirenPulse();
  virtual void playSpatialSiren(const glm::vec3& worldPos);

  /** Iron Pit bell ring & crowd roar. */
  virtual void playPitBell(bool roundEnd = false);
  virtual void playCrowdCheer(float intensity = 0.85f);

  /** Vehicle impact & continuous engine RPM rumble. */
  virtual void playVehicleCrash(float strength = 0.8f);
  virtual void playExplosion(const glm::vec3& worldPos);
  virtual void setEngineState(bool inVehicle, float speedRatio);

  bool initialized() const { return initialized_; }

private:
  struct ActiveGrain {
    double phase = 0.0;
    double duration = 0.1;
    double freq = 140.0;
    double endFreq = 60.0;
    float gain = 0.25f;
    float noiseMix = 0.35f;
    float pan = 0.0f; // -1 = left, 0 = center, +1 = right
    uint32_t rng = 0x1234567u;
  };

  void computeSpatial(const glm::vec3& worldPos, float maxDist, float& outGain, float& outPan) const;
  void pushGrain(const ActiveGrain& g);
  void mixSamples(float* output, uint32_t frameCount);
  static void dataCallback(void* device, void* output, const void* input, uint32_t frameCount);

  struct Impl;
  Impl* impl_ = nullptr;
  bool initialized_ = false;
  std::atomic<uint32_t> writeIdx_{0};
  std::atomic<float> listenerX_{0.0f};
  std::atomic<float> listenerY_{0.0f};
  std::atomic<float> listenerZ_{0.0f};
  std::atomic<float> listenerYaw_{0.0f};
  std::atomic<float> engineGain_{0.0f};
  std::atomic<float> engineSpeedRatio_{0.0f};
  double enginePhaseA_ = 0.0;
  double enginePhaseB_ = 0.0;
  std::vector<ActiveGrain> grains_;
  double sampleRate_ = 48000.0;

  struct DecodedClip {
    std::vector<float> stereoSamples; // interleaved L, R
    size_t frameCount() const { return stereoSamples.size() / 2; }
  };
  std::shared_ptr<const DecodedClip> loadOrGetClip(const std::string& relPath);

  std::string assetsRoot_;
  mutable std::mutex streamMutex_;
  std::unordered_map<std::string, std::shared_ptr<const DecodedClip>> clipCache_;

  std::shared_ptr<const DecodedClip> activeVoice_;
  size_t voiceFrameCursor_ = 0;
  float voiceGain_ = 0.85f;
  float voicePan_ = 0.0f;

  std::shared_ptr<const DecodedClip> activeComms_;
  size_t commsFrameCursor_ = 0;
  float commsGain_ = 0.75f;
  float commsPan_ = 0.0f;

  std::shared_ptr<const DecodedClip> activeMusic_;
  size_t musicFrameCursor_ = 0;
  float musicGain_ = 0.24f;
  bool musicLoop_ = true;
  std::string activeMusicPath_;
};

} // namespace westgate
