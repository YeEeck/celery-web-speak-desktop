{
  "targets": [
    {
      "target_name": "application_audio",
      "sources": [
        "src/addon.cpp",
        "src/process-loopback.cpp",
        "src/session-monitor.cpp"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "UNICODE",
        "_UNICODE",
        "WIN32_LEAN_AND_MEAN",
        "NOMINMAX"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20"],
          "ExceptionHandling": 1
        }
      },
      "libraries": [
        "ole32.lib",
        "uuid.lib"
      ]
    }
  ]
}

