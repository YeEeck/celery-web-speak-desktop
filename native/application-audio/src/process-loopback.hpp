#pragma once

#include <windows.h>

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace application_audio {

enum class ProbeReason {
  kNone,
  kUnsupportedPlatform,
  kUnsupportedWindowsVersion,
  kProcessLoopbackUnavailable,
};

struct ProbeResult {
  bool supported = false;
  ProbeReason reason = ProbeReason::kProcessLoopbackUnavailable;
  std::uint32_t windows_build = 0;
};

enum class CaptureEventType {
  kStarted,
  kPcm,
  kSourceDestroyed,
  kSourceProcessExited,
  kCaptureError,
};

struct CaptureEvent {
  CaptureEventType type = CaptureEventType::kCaptureError;
  std::uint32_t frames = 0;
  std::vector<float> samples;
};

struct CaptureStatistics {
  std::uint64_t delivered_blocks = 0;
  std::uint64_t dropped_blocks = 0;
  std::uint32_t buffered_frames = 0;
};

using CaptureListener = std::function<bool(CaptureEvent&&)>;

ProbeResult ProbeProcessLoopback();

class ProcessLoopbackCapture {
 public:
  ProcessLoopbackCapture();
  ~ProcessLoopbackCapture();

  ProcessLoopbackCapture(const ProcessLoopbackCapture&) = delete;
  ProcessLoopbackCapture& operator=(const ProcessLoopbackCapture&) = delete;

  bool Start(const std::string& hwnd_decimal, CaptureListener listener);
  void Pause();
  void Resume();
  void Stop();
  CaptureStatistics Snapshot() const;

 private:
  void CaptureThread(std::string hwnd_decimal);
  bool Emit(CaptureEvent&& event);

  CaptureListener listener_;
  std::thread thread_;
  HANDLE stop_event_ = nullptr;
  HANDLE command_event_ = nullptr;
  std::atomic<bool> pause_requested_{false};
  std::atomic<bool> running_{false};
  std::atomic<std::uint64_t> delivered_blocks_{0};
  std::atomic<std::uint64_t> dropped_blocks_{0};
  std::atomic<std::uint32_t> buffered_frames_{0};
};

}  // namespace application_audio

