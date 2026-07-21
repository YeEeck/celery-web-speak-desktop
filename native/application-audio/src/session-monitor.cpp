#include "session-monitor.hpp"

#include <charconv>
#include <cstdint>
#include <limits>

namespace application_audio {

SessionMonitor::SessionMonitor() = default;

SessionMonitor::~SessionMonitor() {
  if (process_) CloseHandle(process_);
}

bool SessionMonitor::Initialize(const std::string& hwnd_decimal) {
  if (hwnd_decimal.empty() || hwnd_decimal.front() == '0') return false;

  std::uint64_t value = 0;
  const char* begin = hwnd_decimal.data();
  const char* end = begin + hwnd_decimal.size();
  const auto result = std::from_chars(begin, end, value, 10);
  if (result.ec != std::errc() || result.ptr != end || value == 0 ||
      value > std::numeric_limits<std::uintptr_t>::max()) {
    return false;
  }

  window_ = reinterpret_cast<HWND>(static_cast<std::uintptr_t>(value));
  if (!IsWindow(window_)) return false;

  DWORD process_id = 0;
  if (GetWindowThreadProcessId(window_, &process_id) == 0 || process_id == 0) return false;
  HANDLE process = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
  if (!process) return false;

  process_id_ = process_id;
  process_ = process;
  return true;
}

TargetStatus SessionMonitor::Poll() const {
  if (!window_ || !IsWindow(window_)) return TargetStatus::kWindowDestroyed;
  if (!process_ || WaitForSingleObject(process_, 0) == WAIT_OBJECT_0) {
    return TargetStatus::kProcessExited;
  }
  DWORD current_process_id = 0;
  if (GetWindowThreadProcessId(window_, &current_process_id) == 0 ||
      current_process_id != process_id_) {
    return TargetStatus::kWindowDestroyed;
  }
  return TargetStatus::kActive;
}

}  // namespace application_audio

