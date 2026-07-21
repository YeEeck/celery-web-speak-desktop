#include "process-loopback.hpp"

#include "session-monitor.hpp"

#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <winternl.h>
#include <wrl/client.h>
#include <wrl/implements.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <memory>

namespace application_audio {
namespace {

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;

constexpr DWORD kMinimumWindowsBuild = 19041;

using ActivateAudioInterfaceAsyncFunction = decltype(&ActivateAudioInterfaceAsync);

class ActivationHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase,
                          IActivateAudioInterfaceCompletionHandler> {
 public:
  ActivationHandler() : completed_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
  ~ActivationHandler() override {
    if (completed_) CloseHandle(completed_);
  }

  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT result = E_FAIL;
    ComPtr<IUnknown> activated;
    const HRESULT completion_result = operation->GetActivateResult(&result, &activated);
    result_ = FAILED(completion_result) ? completion_result : result;
    activated_ = activated;
    SetEvent(completed_);
    return S_OK;
  }

  HRESULT Wait(ComPtr<IAudioClient>* audio_client) {
    if (!completed_ || WaitForSingleObject(completed_, 5'000) != WAIT_OBJECT_0) {
      return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    }
    if (FAILED(result_) || !activated_) return FAILED(result_) ? result_ : E_NOINTERFACE;
    return activated_.As(audio_client);
  }

 private:
  HANDLE completed_ = nullptr;
  HRESULT result_ = E_FAIL;
  ComPtr<IUnknown> activated_;
};

DWORD ReadWindowsBuild() {
  using RtlGetVersionFunction = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return 0;
  auto rtl_get_version = reinterpret_cast<RtlGetVersionFunction>(
      GetProcAddress(ntdll, "RtlGetVersion"));
  if (!rtl_get_version) return 0;
  RTL_OSVERSIONINFOW version{};
  version.dwOSVersionInfoSize = sizeof(version);
  return rtl_get_version(&version) == 0 ? version.dwBuildNumber : 0;
}

ActivateAudioInterfaceAsyncFunction ResolveActivationFunction() {
  HMODULE module = LoadLibraryW(L"mmdevapi.dll");
  if (!module) return nullptr;
  return reinterpret_cast<ActivateAudioInterfaceAsyncFunction>(
      GetProcAddress(module, "ActivateAudioInterfaceAsync"));
}

HRESULT ActivateForProcess(DWORD process_id, ComPtr<IAudioClient>* audio_client) {
  auto activate = ResolveActivationFunction();
  if (!activate) return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);

  AUDIOCLIENT_ACTIVATION_PARAMS parameters{};
  parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  parameters.ProcessLoopbackParams.TargetProcessId = process_id;
  parameters.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activate_parameters{};
  activate_parameters.vt = VT_BLOB;
  activate_parameters.blob.cbSize = sizeof(parameters);
  activate_parameters.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);

  auto handler = Make<ActivationHandler>();
  if (!handler) return E_OUTOFMEMORY;
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  HRESULT result = activate(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
                            &activate_parameters, handler.Get(), &operation);
  if (FAILED(result)) return result;
  return handler->Wait(audio_client);
}

WAVEFORMATEXTENSIBLE FixedCaptureFormat() {
  WAVEFORMATEXTENSIBLE format{};
  format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  format.Format.nChannels = 2;
  format.Format.nSamplesPerSec = 48'000;
  format.Format.wBitsPerSample = 32;
  format.Format.nBlockAlign = format.Format.nChannels * sizeof(float);
  format.Format.nAvgBytesPerSec = format.Format.nSamplesPerSec * format.Format.nBlockAlign;
  format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  format.Samples.wValidBitsPerSample = 32;
  format.dwChannelMask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
  format.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
  return format;
}

HRESULT InitializeAudioClient(IAudioClient* audio_client, HANDLE sample_event) {
  auto format = FixedCaptureFormat();
  const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK |
                      AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                      AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  HRESULT result = audio_client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0,
                                            &format.Format, nullptr);
  if (FAILED(result)) return result;
  return audio_client->SetEventHandle(sample_event);
}

}  // namespace

ProbeResult ProbeProcessLoopback() {
  ProbeResult result;
  if (sizeof(void*) != 8) {
    result.reason = ProbeReason::kUnsupportedPlatform;
    return result;
  }
  result.windows_build = ReadWindowsBuild();
  if (result.windows_build < kMinimumWindowsBuild) {
    result.reason = ProbeReason::kUnsupportedWindowsVersion;
    return result;
  }

  const HRESULT com_result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(com_result) && com_result != RPC_E_CHANGED_MODE) return result;
  ComPtr<IAudioClient> audio_client;
  const HRESULT activation_result = ActivateForProcess(GetCurrentProcessId(), &audio_client);
  HANDLE sample_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  const HRESULT initialization_result = SUCCEEDED(activation_result) && audio_client && sample_event
      ? InitializeAudioClient(audio_client.Get(), sample_event)
      : E_FAIL;
  audio_client.Reset();
  if (sample_event) CloseHandle(sample_event);
  if (SUCCEEDED(com_result)) CoUninitialize();
  if (FAILED(activation_result) || FAILED(initialization_result)) return result;

  result.supported = true;
  result.reason = ProbeReason::kNone;
  return result;
}

ProcessLoopbackCapture::ProcessLoopbackCapture() {
  stop_event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  command_event_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
}

ProcessLoopbackCapture::~ProcessLoopbackCapture() {
  Stop();
  if (command_event_) CloseHandle(command_event_);
  if (stop_event_) CloseHandle(stop_event_);
}

bool ProcessLoopbackCapture::Start(const std::string& hwnd_decimal, CaptureListener listener) {
  if (!stop_event_ || !command_event_ || thread_.joinable()) return false;
  running_ = true;
  ResetEvent(stop_event_);
  pause_requested_ = false;
  listener_ = std::move(listener);
  delivered_blocks_ = 0;
  dropped_blocks_ = 0;
  buffered_frames_ = 0;
  thread_ = std::thread(&ProcessLoopbackCapture::CaptureThread, this, hwnd_decimal);
  return true;
}

void ProcessLoopbackCapture::Pause() {
  if (!running_) return;
  pause_requested_ = true;
  SetEvent(command_event_);
}

void ProcessLoopbackCapture::Resume() {
  if (!running_) return;
  pause_requested_ = false;
  SetEvent(command_event_);
}

void ProcessLoopbackCapture::Stop() {
  if (!thread_.joinable()) return;
  running_ = false;
  SetEvent(stop_event_);
  thread_.join();
  listener_ = nullptr;
  buffered_frames_ = 0;
}

CaptureStatistics ProcessLoopbackCapture::Snapshot() const {
  return {
      delivered_blocks_.load(),
      dropped_blocks_.load(),
      buffered_frames_.load(),
  };
}

bool ProcessLoopbackCapture::Emit(CaptureEvent&& event) {
  if (!listener_ || !listener_(std::move(event))) {
    ++dropped_blocks_;
    return false;
  }
  return true;
}

void ProcessLoopbackCapture::CaptureThread(std::string hwnd_decimal) {
  const HRESULT com_result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  SessionMonitor target;
  HANDLE sample_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  ComPtr<IAudioClient> audio_client;
  ComPtr<IAudioCaptureClient> capture_client;

  auto fail = [&]() { Emit({CaptureEventType::kCaptureError}); };
  if ((FAILED(com_result) && com_result != RPC_E_CHANGED_MODE) || !sample_event ||
      !target.Initialize(hwnd_decimal) ||
      FAILED(ActivateForProcess(target.process_id(), &audio_client)) || !audio_client ||
      FAILED(InitializeAudioClient(audio_client.Get(), sample_event)) ||
      FAILED(audio_client->GetService(IID_PPV_ARGS(&capture_client))) ||
      FAILED(audio_client->Start())) {
    fail();
  } else {
    Emit({CaptureEventType::kStarted});
    bool audio_running = true;
    std::array<HANDLE, 3> events{stop_event_, command_event_, sample_event};
    while (running_) {
      const DWORD wait = WaitForMultipleObjects(static_cast<DWORD>(events.size()), events.data(),
                                                FALSE, 250);
      if (wait == WAIT_OBJECT_0) break;

      const TargetStatus status = target.Poll();
      if (status == TargetStatus::kWindowDestroyed) {
        Emit({CaptureEventType::kSourceDestroyed});
        break;
      }
      if (status == TargetStatus::kProcessExited) {
        Emit({CaptureEventType::kSourceProcessExited});
        break;
      }

      if (wait == WAIT_OBJECT_0 + 1) {
        if (pause_requested_ && audio_running) {
          audio_client->Stop();
          audio_running = false;
        } else if (!pause_requested_ && !audio_running) {
          if (FAILED(audio_client->Start())) {
            fail();
            break;
          }
          audio_running = true;
        }
        continue;
      }
      if (wait == WAIT_TIMEOUT || !audio_running) continue;
      if (wait != WAIT_OBJECT_0 + 2) {
        fail();
        break;
      }

      UINT32 packet_frames = 0;
      HRESULT packet_result = capture_client->GetNextPacketSize(&packet_frames);
      while (SUCCEEDED(packet_result) && packet_frames > 0) {
        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        packet_result = capture_client->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
        if (FAILED(packet_result)) break;

        CaptureEvent event;
        event.type = CaptureEventType::kPcm;
        event.frames = frames;
        event.samples.resize(static_cast<std::size_t>(frames) * 2);
        if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0 && data) {
          std::memcpy(event.samples.data(), data, event.samples.size() * sizeof(float));
        }
        buffered_frames_ = frames;
        if (Emit(std::move(event))) ++delivered_blocks_;
        buffered_frames_ = 0;
        capture_client->ReleaseBuffer(frames);
        packet_result = capture_client->GetNextPacketSize(&packet_frames);
      }
      if (FAILED(packet_result)) {
        fail();
        break;
      }
    }
    if (audio_running) audio_client->Stop();
  }

  capture_client.Reset();
  audio_client.Reset();
  if (sample_event) CloseHandle(sample_event);
  if (SUCCEEDED(com_result)) CoUninitialize();
  running_ = false;
}

}  // namespace application_audio
