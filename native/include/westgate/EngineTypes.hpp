#pragma once

#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <mutex>
#include <thread>
#include <vector>

namespace westgate {

struct AABB {
  glm::vec3 min{0.0f};
  glm::vec3 max{0.0f};

  glm::vec3 center() const { return (min + max) * 0.5f; }
  glm::vec3 extents() const { return (max - min) * 0.5f; }

  bool intersects(const AABB& o) const {
    return min.x <= o.max.x && max.x >= o.min.x &&
           min.y <= o.max.y && max.y >= o.min.y &&
           min.z <= o.max.z && max.z >= o.min.z;
  }
};

/**
 * 6-plane view frustum extracted from column-major viewProjection matrix (Gribb/Hartmann).
 * Used on background/render threads to cull entire 160m world chunks and prop buckets before draw submission.
 */
struct Frustum {
  std::array<glm::vec4, 6> planes{};

  static Frustum fromViewProj(const glm::mat4& vp) {
    Frustum f;
    // Row vectors of VP
    const glm::vec4 r0(vp[0][0], vp[1][0], vp[2][0], vp[3][0]);
    const glm::vec4 r1(vp[0][1], vp[1][1], vp[2][1], vp[3][1]);
    const glm::vec4 r2(vp[0][2], vp[1][2], vp[2][2], vp[3][2]);
    const glm::vec4 r3(vp[0][3], vp[1][3], vp[2][3], vp[3][3]);

    f.planes[0] = r3 + r0; // Left
    f.planes[1] = r3 - r0; // Right
    f.planes[2] = r3 + r1; // Bottom
    f.planes[3] = r3 - r1; // Top
    f.planes[4] = r2;      // Near (WebGPU [0..1] depth range)
    f.planes[5] = r3 - r2; // Far

    for (auto& p : f.planes) {
      const float len = glm::length(glm::vec3(p));
      if (len > 1e-6f) p /= len;
    }
    return f;
  }

  bool intersectsAABB(const AABB& b) const {
    for (const auto& p : planes) {
      const glm::vec3 n(p);
      const glm::vec3 pv(
        n.x >= 0.0f ? b.max.x : b.min.x,
        n.y >= 0.0f ? b.max.y : b.min.y,
        n.z >= 0.0f ? b.max.z : b.min.z
      );
      if (glm::dot(n, pv) + p.w < 0.0f) return false;
    }
    return true;
  }
};

/**
 * Multi-threaded engine worker pool for async chunk hydration, GLB decoding, and world streaming.
 */
class JobSystem {
 public:
  explicit JobSystem(uint32_t workerCount = 0) {
    const uint32_t hw = std::thread::hardware_concurrency();
    const uint32_t count = workerCount > 0 ? workerCount : (hw > 2 ? hw - 1 : 2);
    workers_.reserve(count);
    for (uint32_t i = 0; i < count; ++i) {
      workers_.emplace_back([this]() { workerLoop(); });
    }
  }

  ~JobSystem() { shutdown(); }

  JobSystem(const JobSystem&) = delete;
  JobSystem& operator=(const JobSystem&) = delete;

  void enqueue(std::function<void()> task) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (stopping_) return;
      queue_.push_back(std::move(task));
      pending_.fetch_add(1, std::memory_order_relaxed);
    }
    cv_.notify_one();
  }

  void waitIdle() {
    std::unique_lock<std::mutex> lock(idleMutex_);
    idleCv_.wait(lock, [this]() { return pending_.load(std::memory_order_acquire) == 0; });
  }

  uint32_t workerCount() const { return static_cast<uint32_t>(workers_.size()); }
  int64_t pendingCount() const { return pending_.load(std::memory_order_relaxed); }

  void shutdown() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (stopping_) return;
      stopping_ = true;
    }
    cv_.notify_all();
    for (auto& w : workers_) {
      if (w.joinable()) w.join();
    }
    workers_.clear();
  }

 private:
  void workerLoop() {
    while (true) {
      std::function<void()> task;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        cv_.wait(lock, [this]() { return stopping_ || !queue_.empty(); });
        if (stopping_ && queue_.empty()) return;
        task = std::move(queue_.front());
        queue_.pop_front();
      }
      if (task) task();
      if (pending_.fetch_sub(1, std::memory_order_acq_rel) == 1) {
        std::lock_guard<std::mutex> ilock(idleMutex_);
        idleCv_.notify_all();
      }
    }
  }

  std::vector<std::thread> workers_;
  std::deque<std::function<void()>> queue_;
  std::mutex mutex_;
  std::condition_variable cv_;
  std::atomic<int64_t> pending_{0};
  std::mutex idleMutex_;
  std::condition_variable idleCv_;
  bool stopping_ = false;
};

class FrameTimer {
 public:
  FrameTimer() : prev_(std::chrono::steady_clock::now()) {}

  double tickSeconds() {
    const auto now = std::chrono::steady_clock::now();
    const double dt = std::chrono::duration<double>(now - prev_).count();
    prev_ = now;
    return dt < 0.0001 ? 0.0001 : (dt > 0.1 ? 0.1 : dt);
  }

 private:
  std::chrono::steady_clock::time_point prev_;
};

} // namespace westgate
