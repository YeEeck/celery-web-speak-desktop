#pragma once

#include <windows.h>

#include <string>

namespace application_audio {

enum class TargetStatus {
  kActive,
  kWindowDestroyed,
  kProcessExited,
};

class SessionMonitor {
 public:
  SessionMonitor();
  ~SessionMonitor();

  SessionMonitor(const SessionMonitor&) = delete;
  SessionMonitor& operator=(const SessionMonitor&) = delete;

  bool Initialize(const std::string& hwnd_decimal);
  TargetStatus Poll() const;
  DWORD process_id() const { return process_id_; }

 private:
  HWND window_ = nullptr;
  DWORD process_id_ = 0;
  HANDLE process_ = nullptr;
};

}  // namespace application_audio

