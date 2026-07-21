#include <node_api.h>

#include "process-loopback.hpp"

#include <cstring>
#include <iterator>
#include <memory>
#include <string>
#include <utility>

namespace application_audio {
namespace {

struct QueuedEvent {
  CaptureEvent event;
};

struct CaptureWrapper {
  napi_env env = nullptr;
  napi_threadsafe_function callback = nullptr;
  ProcessLoopbackCapture capture;
};

void SetNamedString(napi_env env, napi_value object, const char* name, const char* value) {
  napi_value output;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &output);
  napi_set_named_property(env, object, name, output);
}

void SetNamedNumber(napi_env env, napi_value object, const char* name, double value) {
  napi_value output;
  napi_create_double(env, value, &output);
  napi_set_named_property(env, object, name, output);
}

void SetNamedBoolean(napi_env env, napi_value object, const char* name, bool value) {
  napi_value output;
  napi_get_boolean(env, value, &output);
  napi_set_named_property(env, object, name, output);
}

const char* ProbeReasonName(ProbeReason reason) {
  switch (reason) {
    case ProbeReason::kUnsupportedPlatform:
      return "unsupported_platform";
    case ProbeReason::kUnsupportedWindowsVersion:
      return "unsupported_windows_version";
    case ProbeReason::kProcessLoopbackUnavailable:
      return "process_loopback_unavailable";
    case ProbeReason::kNone:
      return "";
  }
  return "process_loopback_unavailable";
}

void CallJavascript(napi_env env, napi_value callback, void*, void* data) {
  std::unique_ptr<QueuedEvent> queued(static_cast<QueuedEvent*>(data));
  if (!env || !callback || !queued) return;

  napi_value event;
  napi_create_object(env, &event);
  switch (queued->event.type) {
    case CaptureEventType::kStarted:
      SetNamedString(env, event, "type", "started");
      break;
    case CaptureEventType::kSourceDestroyed:
      SetNamedString(env, event, "type", "source_destroyed");
      break;
    case CaptureEventType::kSourceProcessExited:
      SetNamedString(env, event, "type", "source_process_exited");
      break;
    case CaptureEventType::kCaptureError:
      SetNamedString(env, event, "type", "capture_error");
      break;
    case CaptureEventType::kPcm: {
      SetNamedString(env, event, "type", "pcm");
      SetNamedNumber(env, event, "frames", queued->event.frames);
      const std::size_t byte_length = queued->event.samples.size() * sizeof(float);
      void* output_data = nullptr;
      napi_value array_buffer;
      napi_create_arraybuffer(env, byte_length, &output_data, &array_buffer);
      if (byte_length > 0) std::memcpy(output_data, queued->event.samples.data(), byte_length);
      napi_set_named_property(env, event, "data", array_buffer);
      break;
    }
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_value ignored;
  napi_call_function(env, undefined, callback, 1, &event, &ignored);
}

CaptureWrapper* Unwrap(napi_env env, napi_callback_info info, napi_value* this_value = nullptr) {
  napi_value receiver;
  napi_get_cb_info(env, info, nullptr, nullptr, &receiver, nullptr);
  CaptureWrapper* wrapper = nullptr;
  napi_unwrap(env, receiver, reinterpret_cast<void**>(&wrapper));
  if (this_value) *this_value = receiver;
  return wrapper;
}

void FinalizeCapture(napi_env env, void* data, void*) {
  auto* wrapper = static_cast<CaptureWrapper*>(data);
  wrapper->capture.Stop();
  if (wrapper->callback) {
    napi_release_threadsafe_function(wrapper->callback, napi_tsfn_abort);
  }
  delete wrapper;
}

napi_value CaptureConstructor(napi_env env, napi_callback_info info) {
  napi_value receiver;
  napi_get_cb_info(env, info, nullptr, nullptr, &receiver, nullptr);
  auto* wrapper = new CaptureWrapper();
  wrapper->env = env;
  napi_wrap(env, receiver, wrapper, FinalizeCapture, nullptr, nullptr);
  return receiver;
}

napi_value Start(napi_env env, napi_callback_info info) {
  std::size_t argument_count = 2;
  napi_value arguments[2];
  napi_value receiver;
  napi_get_cb_info(env, info, &argument_count, arguments, &receiver, nullptr);
  CaptureWrapper* wrapper = nullptr;
  napi_unwrap(env, receiver, reinterpret_cast<void**>(&wrapper));
  if (!wrapper || argument_count != 2) {
    napi_throw_type_error(env, nullptr, "start requires options and listener");
    return nullptr;
  }

  napi_value hwnd_value;
  if (napi_get_named_property(env, arguments[0], "hwndDecimal", &hwnd_value) != napi_ok) {
    napi_throw_type_error(env, nullptr, "hwndDecimal is required");
    return nullptr;
  }
  std::size_t length = 0;
  napi_get_value_string_utf8(env, hwnd_value, nullptr, 0, &length);
  std::string hwnd_decimal(length + 1, '\0');
  napi_get_value_string_utf8(env, hwnd_value, hwnd_decimal.data(), hwnd_decimal.size(), &length);
  hwnd_decimal.resize(length);

  napi_value resource_name;
  napi_create_string_utf8(env, "application-audio-capture", NAPI_AUTO_LENGTH, &resource_name);
  if (wrapper->callback || napi_create_threadsafe_function(
          env, arguments[1], nullptr, resource_name, 64, 1, nullptr, nullptr, nullptr,
          CallJavascript, &wrapper->callback) != napi_ok) {
    napi_throw_error(env, nullptr, "capture listener is already active");
    return nullptr;
  }

  const bool started = wrapper->capture.Start(hwnd_decimal, [wrapper](CaptureEvent&& event) {
    auto* queued = new QueuedEvent{std::move(event)};
    const napi_status status = napi_call_threadsafe_function(
        wrapper->callback, queued, napi_tsfn_nonblocking);
    if (status != napi_ok) {
      delete queued;
      return false;
    }
    return true;
  });
  if (!started) {
    napi_release_threadsafe_function(wrapper->callback, napi_tsfn_abort);
    wrapper->callback = nullptr;
    napi_throw_error(env, nullptr, "capture session could not be started");
    return nullptr;
  }
  return receiver;
}

napi_value Pause(napi_env env, napi_callback_info info) {
  auto* wrapper = Unwrap(env, info);
  if (wrapper) wrapper->capture.Pause();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Resume(napi_env env, napi_callback_info info) {
  auto* wrapper = Unwrap(env, info);
  if (wrapper) wrapper->capture.Resume();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Stop(napi_env env, napi_callback_info info) {
  auto* wrapper = Unwrap(env, info);
  if (wrapper) {
    wrapper->capture.Stop();
    if (wrapper->callback) {
      napi_release_threadsafe_function(wrapper->callback, napi_tsfn_release);
      wrapper->callback = nullptr;
    }
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Snapshot(napi_env env, napi_callback_info info) {
  auto* wrapper = Unwrap(env, info);
  const CaptureStatistics statistics = wrapper ? wrapper->capture.Snapshot() : CaptureStatistics{};
  napi_value output;
  napi_create_object(env, &output);
  SetNamedNumber(env, output, "deliveredBlocks", static_cast<double>(statistics.delivered_blocks));
  SetNamedNumber(env, output, "droppedBlocks", static_cast<double>(statistics.dropped_blocks));
  SetNamedNumber(env, output, "bufferedFrames", statistics.buffered_frames);
  return output;
}

napi_value Probe(napi_env env, napi_callback_info) {
  const ProbeResult result = ProbeProcessLoopback();
  napi_value output;
  napi_create_object(env, &output);
  SetNamedBoolean(env, output, "supported", result.supported);
  if (result.reason == ProbeReason::kNone) {
    napi_value null_value;
    napi_get_null(env, &null_value);
    napi_set_named_property(env, output, "reason", null_value);
  } else {
    SetNamedString(env, output, "reason", ProbeReasonName(result.reason));
  }
  SetNamedNumber(env, output, "windowsBuild", result.windows_build);
  return output;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
      {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"pause", nullptr, Pause, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"resume", nullptr, Resume, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"snapshot", nullptr, Snapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_value constructor;
  napi_define_class(env, "ApplicationAudioCapture", NAPI_AUTO_LENGTH, CaptureConstructor,
                    nullptr, std::size(methods), methods, &constructor);
  napi_set_named_property(env, exports, "ApplicationAudioCapture", constructor);

  napi_value probe;
  napi_create_function(env, "probe", NAPI_AUTO_LENGTH, Probe, nullptr, &probe);
  napi_set_named_property(env, exports, "probe", probe);
  return exports;
}

}  // namespace
}  // namespace application_audio

NAPI_MODULE(NODE_GYP_MODULE_NAME, application_audio::Initialize)
