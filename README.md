# Built-app recovery checks

All three recovery cases passed in complete bundled apps on macOS 15 (arm64), Ubuntu 24.04, and Windows Server 2025.

The app used its packaged Python backend, package manager, and native llama.cpp engine. Test servers controlled the download failures. Native inference used the real SmolLM2-135M-Q4_K_M model.

## Cases and results

| Case | Sequence | Observed result |
| --- | --- | --- |
| Engine recovery | Interrupt the engine transfer, select Pause, restart the app and backend, restore the connection, and select Resume. | The saved 1 MiB survived restart. Resume skipped saved ranges and finished setup. |
| Discard | Interrupt setup with completed files present, restart, select Discard, and restart again. | The job and unused partial files were gone. Two completed files kept their contents and modification times. |
| Model recovery | Cut the model transfer, return status 503 from the proxy, restart, restore the connection, and select Resume. | Saved ranges survived restart. Resume downloaded only missing ranges and finished setup. |

Both Resume cases verified the model hash, default model selection, and eight tokens from the native engine. Cleanup checks found no remaining test processes.

## Matching UI states

Each row shows the same three states on one platform. The images show recovery controls; range and file checks establish byte retention and file preservation. Small test fixtures round to 0.0 GB in the UI.

| Platform | Engine after restart | Discard explanation | Model after restart |
| --- | --- | --- | --- |
| macOS 15 | [View](screenshots/macOS-engine-recovery.png) | [View](screenshots/macOS-discard.png) | [View](screenshots/macOS-model-recovery.png) |
| Ubuntu 24.04 | [View](screenshots/Linux-engine-recovery.png) | [View](screenshots/Linux-discard.png) | [View](screenshots/Linux-model-recovery.png) |
| Windows Server 2025 | [View](screenshots/Windows-engine-recovery.png) | [View](screenshots/Windows-discard.png) | [View](screenshots/Windows-model-recovery.png) |

## Language checks

Each macOS language case restored a saved partial file, selected Resume against HTTP 503, selected Pause, inspected the Discard tooltip, and selected Discard. The checks confirmed removal of unused partial files and preservation of completed files. All nine Discard-tooltip captures were inspected. Resume and Discard button bounds were checked for clipping.

| Language | Direction | Controls and tooltip |
| --- | --- | --- |
| English | Left to right | [View](languages/en.png) |
| Arabic | Right to left | [View](languages/ar.png) |
| Simplified Chinese | Left to right | [View](languages/zh.png) |
| Traditional Chinese | Left to right | [View](languages/zh-hant.png) |
| Japanese | Left to right | [View](languages/ja.png) |
| Russian | Left to right | [View](languages/ru.png) |
| French | Left to right | [View](languages/fr.png) |
| German | Left to right | [View](languages/de.png) |
| Spanish | Left to right | [View](languages/es.png) |

## Test source

- [App source: ab8385caa9](https://github.com/ocasta181/hermes-agent/commit/ab8385caa9484993e1aaaa28e438c9cbd50ffc0e).
- [Completed native and language workflow](https://github.com/ocasta181/hermes-agent/actions/runs/39245900791).
- [Native UI procedure](https://github.com/ocasta181/hermes-agent/blob/24195078323913220e98746363d1d524ab9ab9be/.review/native-ui.spec.mjs) and [inference checks](https://github.com/ocasta181/hermes-agent/blob/24195078323913220e98746363d1d524ab9ab9be/.review/probe.py).
- [Language procedure](https://github.com/ocasta181/hermes-agent/blob/24195078323913220e98746363d1d524ab9ab9be/.review/locale.spec.mjs).
- [Recorded observations](validation.json) contain the per-case byte counts, model hashes, setup steps, language checks, and cleanup results.
