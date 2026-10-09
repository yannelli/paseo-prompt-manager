# End-to-end tests

Created: 2026-10-09
Last updated: 2026-10-09

The E2E suites run the plugin inside real Paseo clients: the web UI that the daemon serves, the Linux desktop app, the Android app, and the iOS app. Each client connects to a daemon started for the test run. After each scenario, the test checks the result where it is stored: prompt files and versions in the library directory, the plugin settings file, the Git remote, or the prompts the agent received.

| Client | Driver | Scenarios | npm script | Workflow |
| --- | --- | --- | --- | --- |
| Web, wide (1280x800) | Playwright, Chromium | `e2e/specs/*.spec.ts` | `npm run e2e:web` | `e2e-web.yml` |
| Web, phone layout (390x844) | Playwright, Chromium | `e2e/specs/*.spec.ts` | `npm run e2e:web` | `e2e-web.yml` |
| Desktop (Linux x64) | Playwright over CDP | `e2e/specs/*.spec.ts` | `npm run e2e:desktop` | `e2e-desktop.yml` |
| Android (API 34 emulator) | Maestro and `node --test` | `e2e/mobile/flows`, `e2e/mobile/mobile.test.ts` | `npm run e2e:mobile` | `e2e-android.yml` |
| iOS (simulator) | Maestro and `node --test` | `e2e/mobile/flows`, `e2e/mobile/mobile.test.ts` | `npm run e2e:mobile` | `e2e-ios.yml` |

All workflows run on pull requests and on pushes to `main` and `beta`. Results, traces, screenshots, and Maestro output go to `e2e/.results/` and are uploaded as workflow artifacts.

## Paseo version

`@getpaseo/cli` in `devDependencies` sets the Paseo version under test. The daemon runs from its `@getpaseo/server` dependency, and the workflows download or build the desktop, Android, and iOS apps for the same version. To test a newer Paseo release, change that version, run `npm install`, and check that every E2E workflow passes.

## Test daemon

`e2e/harness/daemon.ts` starts a daemon with:

- its own `PASEO_HOME` and `XDG_CONFIG_HOME` in a temporary directory, so the plugin's settings and default library never touch your own;
- this checkout installed as a directory plugin;
- relay, dictation, and voice off;
- `prompt-e2e`, an ACP provider that runs `e2e/harness/recording-agent.mjs`.

The recording agent writes every prompt it receives to `.received.jsonl` in the agent's working directory. `receivedTexts()` and `receivedPrompts()` in `e2e/harness/library.ts` read it, so a test can check the text the composer pill, slash commands, agent panel, and attachments actually delivered.

`TestLibrary` gives each test an empty library directory and points the plugin at it. The plugin reads its settings file on every request, so tests can share one daemon.

Set `PROMPT_E2E_KEEP=1` to keep the temporary directories, including `daemon.log`, after a run.

## Run locally

Web:

```sh
npm ci
npx playwright install chromium
npm run e2e:web
```

Desktop needs the Linux x64 app from the [Paseo release](https://github.com/getpaseo/paseo/releases) for the pinned version, and a display:

```sh
mkdir -p /tmp/paseo-desktop
tar -xzf Paseo-0.11.1-x64.tar.gz -C /tmp/paseo-desktop
PASEO_DESKTOP_BIN=/tmp/paseo-desktop/Paseo-0.11.1-x64/Paseo xvfb-run -a npm run e2e:desktop
```

The desktop app attaches to the test daemon through `PASEO_HOME` and uses a temporary Electron profile.

Mobile needs [Maestro](https://maestro.dev) and a running emulator or booted simulator with the Paseo app installed:

```sh
PROMPT_E2E_PLATFORM=android npm run e2e:mobile
PROMPT_E2E_PLATFORM=ios PROMPT_E2E_DEVICE=<simulator UDID> npm run e2e:mobile
```

| Variable | Meaning |
| --- | --- |
| `PROMPT_E2E_PLATFORM` | `android` (default) or `ios` |
| `PROMPT_E2E_APP_ID` | App package or bundle ID, default `sh.paseo` |
| `PROMPT_E2E_APP_PATH` | APK or `.app` to install before the run |
| `PROMPT_E2E_DEVICE` | adb serial or simulator UDID |
| `PROMPT_E2E_PATTERN` | Regular expression; runs only scenarios whose title matches |
| `MAESTRO_BIN` | Maestro executable, default `maestro` |

On Android the runner forwards the daemon port with `adb reverse`. The iOS simulator reaches the host's `127.0.0.1` directly.

### iOS simulator build

Paseo does not publish a simulator app. On an Apple Silicon Mac with Xcode and CocoaPods installed, build the pinned version:

```sh
e2e/ios/build-app.sh 0.11.1 /tmp/paseo-ios-app
PROMPT_E2E_PLATFORM=ios \
  PROMPT_E2E_DEVICE=<simulator-UDID> \
  PROMPT_E2E_APP_PATH=/tmp/paseo-ios-app/Paseo.app \
  npm run e2e:mobile
```

The build script clones `getpaseo/paseo` at `v<version>` into a disposable source directory, then builds an unsigned Release app with bundled JavaScript, `APP_VARIANT=production`, and bundle ID `sh.paseo`. It deletes that source directory before cloning; do not point `PASEO_SRC_DIR` at a checkout you want to keep.

**Host modification:** `e2e/ios/patch-host.mjs` sets `accessible={false}` on Paseo's `IsolatedBottomSheetModal`. Without it, iOS exposes the entire sheet as one accessibility element and Maestro cannot reach the picker rows. This changes the host's accessibility tree, not the plugin. These tests therefore cover a patched simulator build, not an unmodified App Store release. The patch fails if its source anchor changes.

CI caches the app by Paseo version, Xcode version, and build-recipe hash. Four `macos-15` jobs run the library, browse, agent, and phone groups. Each connects a fresh app to its own daemon. The workflow prefers an iPhone 16 on iOS 18; it logs the selected device and runtime. `e2e/ios/warm-up.ts` starts Maestro's XCUITest driver before the scenarios.

### Mobile driver and assertions

Both mobile workflows pin Maestro 2.11.0 and verify the download's SHA-256. Android uses the published APK on an API 34 emulator. `e2e/mobile/hooks.ts` provides a loopback endpoint for selecting all text through adb, which Maestro flows use when replacing Android text fields.

Keyboard checks read Android's input-method state or the iOS accessibility hierarchy. On iOS, the key rows establish that the software keyboard is visible; the suggestion bar is included in its top edge. The tests compare the focused field's bounds against that edge and check that **Done** dismisses the keyboard.

Maestro artifacts retain failed attempts as well as successful runs. Restartable flows can retry once after a driver reset. On iOS, a flow whose process hangs during shutdown counts as passed only after Maestro reports the final `e2e-flow-end` sentinel as completed with no failed steps or exceptions. A timeout before that sentinel fails the flow.

## What the suites cover

Every client covers:

- opening the library from the sidebar or drawer;
- creating a prompt with a filename, description, tags, a new folder, and content;
- saving edits as versions and restoring an older version;
- the discard-changes prompt;
- archiving and restoring;
- search, folder, and tag filters;
- importing from paths on the host;
- changing the library directory;
- Git sync set up and Sync now against a local bare repository;
- sending a prompt from the composer pill, `/prompt <id>`, and the `/prompts` agent panel;
- attaching a saved prompt to a message.

The wide web and desktop clients also cover both Command Center items, and the web client covers the browser file picker. The phone layouts (web phone, Android, iOS) also check the issue #9 fixes: the picker sheet opens at most of the screen height and reaches its last result, and the library header shows only on the list. Android and iOS also check that the focused field stays above the keyboard and that **Done** in the expanded editor hides the keyboard.

Tests that do not apply to a client skip with the reason in the skip message.

## Selectors

Tests find controls by their accessibility labels, which the plugin already sets for screen readers. Three test IDs mark containers: `prompt-library` (library and agent panel), `prompt-picker` (composer pill picker), and `prompt-confirm` (confirmation dialog buttons). When you rename a label, update `e2e/specs/app.ts` and the flows under `e2e/mobile/flows`.
