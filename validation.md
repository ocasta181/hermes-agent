# Download recovery validation

Source: `6c215dff950b1cf3a6f474bd55f82ef52d41e9ee`. Platform: macOS 26.4, arm64.

## Results

- Python: 208 tests passed across 21 files.
- Desktop: 53 tests passed across six files.
- Built Electron UI: five tests passed.
- Repository checks: 12 passed. Code health: zero blocking and zero advisory findings.
- Desktop source build, TypeScript checks, and targeted ESLint passed. ESLint reported no warnings.

These are focused checks. The full Python suite and current changes on Linux or Windows were not tested. The original external connection reset remains unexplained.

## Reproduce

Use an isolated Python environment with the repository's test dependencies.

```sh
scripts/run_tests.sh \
  tests/pm/test_downloader.py \
  tests/pm/test_downloader_integrity.py \
  tests/pm/test_download_recovery.py \
  tests/pm/test_download_checkpoint_policy.py \
  tests/pm/test_download_retry_limits.py \
  tests/pm/test_download_serial_fallback.py \
  tests/pm/test_download_mirrors.py \
  tests/pm/test_download_progress.py \
  tests/pm/test_download_state.py \
  tests/pm/test_network.py \
  tests/pm/test_network_retries.py \
  tests/pm/test_install_download_control.py \
  tests/hermes_cli/test_local_download_jobs.py \
  tests/hermes_cli/test_local_download_recovery.py \
  tests/hermes_cli/test_local_download_ownership.py \
  tests/hermes_cli/test_local_download_lifecycle.py \
  tests/hermes_cli/test_local_download_polling.py \
  tests/hermes_cli/test_local_quickstart_recovery.py \
  tests/hermes_cli/test_model_flow_local.py \
  tests/hermes_cli/test_local_models_routes.py \
  tests/hermes_cli/test_local_runtime_pm.py

cd apps/desktop
npx vitest run \
  src/app/settings/local-model-download-progress.test.tsx \
  src/store/local-runtime-jobs.test.ts \
  src/store/local-models-surfaces.test.tsx \
  src/api/local-models-owner.test.ts \
  src/i18n/overlay-completeness.test.ts \
  scripts/i18n-keys.test.mjs
npm run typecheck
cd ../..
python scripts/check
npm run build --workspace apps/desktop
cd apps/desktop
HERMES_DESKTOP_PYTHON=/path/to/isolated/python npx playwright test \
  e2e/boot.spec.ts e2e/local-model-download-recovery.spec.ts --workers=1 --reporter=list
```

## Exploratory built UI checks

The source build ran with an isolated home, backend, and local HTTP fixture. A mock model provider supplied the app configuration. The job API and downloader were real.

1. Restore a plan with a completed 17-byte file and a 64 MiB file with 16 MiB saved.
2. Select German. Click Fortsetzen (Resume). Redirect the next file request to a reserved invalid hostname. The macOS resolver reports `EAI_NONAME` (Errno 8). The job stays paused with Resume and the same saved bytes. No destination file appears.
3. Restore the fixture endpoint. Click Resume. Check the complete 64 MiB file against the source bytes. All body requests begin at or above 16 MiB. The completed file stays unchanged.
4. Restart the app and backend with a fresh partial fixture. Return HTTP 503. Click Resume, Pause, and Discard through the German controls. The job, plan, partial file, and coverage metadata are removed. The completed file's content and modification time stay unchanged.

The cropped capture shows the translated recovery status and usable Resume control after the DNS failure. The Discard tooltip explains which files stay. The byte display rounds 16 MiB to 0.0 GB; the API and disk checks verify the exact byte count.

The DNS check uses an unresolved hostname. Wi-Fi was not switched off. Engine installation, inference, and hardware selection were not exercised through this UI fixture. Quickstart tests use fixture callbacks for server startup and default assignment.

## Regression evidence

Before the corresponding fixes, tests reproduced excessive checkpoint writes, the extended Retry-After policy on non-resumable requests, repeated scans during polling, missing runtime-only Discard, and retained discarded partials. Two further tests failed for DNS loss of Resume and deletion of a partial referenced by another saved plan. These tests pass with this source.

## Checkpoint measurement

The attached JSON records five alternating before/after runs: 512 MiB, eight connections, local HTTP, SHA-256 checked. The comparison uses the old PR downloader and this checkpoint policy, with the same network module and no failed requests.

Median checkpoint writes fell from 15 to one. Median throughput fell from 1407 to 1358 MiB/s (about 3.5%). This measurement does not show a speed increase. It uses an in-memory source and a local macOS disk cache. It does not establish performance on remote servers, Linux, or Windows.
