# The 3D office in the fork's Android app: design

Date: 2026-11-18. Status: designed. Sub-project 5 of
[the office after the owner's review](2026-11-16-office-owner-review-design.md).

## Request

Point 10 of the owner's review:

10. The 3D office works on Android too.

## The owner's answers

| Question                      | Answer                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Which way to the phone        | The fork's own Android app, installed beside the store app.                                    |
| How the APK reaches the phone | A prerelease on `allrested/paseo`, uploaded only after the owner says yes each time.           |
| How the scene runs in the app | A general `ScriptFrame` in the plugin kit, not an office-only view and not the WebView itself. |

## What was there

- The installed app is upstream's store build (`sh.paseo`). Its one frame for plugins,
  `DocumentFrame` (`packages/app/src/file-panels/document-frame/index.tsx`), is a
  `react-native-webview` with `javaScriptEnabled={false}` that loads only `file:` URLs. The fork
  cannot change an app upstream builds and publishes.
- The app already depends on `react-native-webview` 13.16.1. A plugin's client gets the kit's
  components from `@getpaseo/plugin/client/ui`, which the app answers with its own module
  (`packages/app/src/plugins/evaluate.ts:580`, `react-native/ui.ts`); a component an app lacks is
  `undefined` there.
- The office offers 3D only in a browser with WebGL2 (`client/office-surface.tsx`,
  `web-env.web.ts`). `client/world/world-frame.web.ts` opens an `iframe` with `srcdoc`, runs the
  scene's script in it and calls `PaseoOfficeWorld` directly. `client/world/world-view.tsx`
  (388 lines) opens that frame and feeds the scene.
- Every `WorldApi` method returns nothing (`client/world/world-api.ts`). `start` takes options with
  callbacks (`onSelect`, `onBoard`, `onProblem`, `onOpen`, `onToast` and the rest) and a brand with
  a `logoUrl`.
- The scene's camera already takes touch: one finger pans, two pinch and twist
  (`vendor/my-office/src/office/scene/renderer.js:68`). The loop lowers the resolution when frames
  are slow (`core/loop.js`, `adaptResolution`). Photo mode hides when `host.photo === false`; Full
  screen hides when `document.fullscreenEnabled` is false; Walk in shows only with `(pointer: fine)`.
- The fork can build an APK locally (`scripts/build-apk.mjs`: app deps, `expo prebuild`,
  `gradlew assembleRelease`, `APP_VARIANT=production`). Its CI workflow builds on EAS under
  upstream's Expo project (`app.config.js` owner `getpaseo`), and the fork has no `EXPO_TOKEN`.
  The app has no `expo-updates`. Variants are `production` (`sh.paseo`) and `development`
  (`sh.paseo.debug`), each with a Firebase file for push.
- This host has Java 17 and no Android SDK; the repo pins Java 21 (`.tool-versions`).

## Approaches

| Approach                                 | Trade-off                                                                                        | Chosen |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| A general `ScriptFrame` in the kit       | One small component any plugin can use; plugins never hold the WebView. Apps without it stay 2D. | Yes    |
| An office-only native view in the app    | Quicker, but one plugin's code lives in the app.                                                 | No     |
| `react-native-webview` handed to plugins | Least kit code; every plugin gets file access and navigation.                                    | No     |
| Chrome on Android, no app                | No build, but not in the app the owner uses.                                                     | No     |

## Decisions

### `ScriptFrame` in the kit

| Question        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The props       | `script: string` (run once after an empty standards-mode page loads), `onMessage(text: string)`, `onError?(message: string)`, `title: string`, `testID?: string`. A ref gives `post(text: string)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| The page's side | `window.paseoFrame.post(text)` sends; `window.paseoFrame.onMessage = (text) => …` receives. Only strings cross.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Before ready    | Posts from the plugin wait in a queue and are delivered in order once the page says it is ready.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Android         | `script-frame.native.tsx`: `WebView` with `source={{ html, baseUrl: "https://script-frame.invalid/" }}` (a `.invalid` name never resolves; it gives the page an origin, so `localStorage` works), `javaScriptEnabled`, `domStorageEnabled` (the scene keeps `office-*` keys), `allowFileAccess={false}`, `allowFileAccessFromFileURLs={false}`, `setSupportMultipleWindows={false}`, `javaScriptCanOpenWindowsAutomatically={false}`, `thirdPartyCookiesEnabled={false}`, `mediaPlaybackRequiresUserAction`. `onShouldStartLoadWithRequest` allows the first load of that base URL only. The page's `post` goes through `ReactNativeWebView.postMessage`; a plugin's `post` is injected as a call of `paseoFrame.onMessage` with the text as a JSON string. |
| Network         | The page carries a CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'`. `form-action` because Android's load guard never sees a POST and `form-action` has no `default-src` fallback, so without it a form could send the page's data away.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Web             | `script-frame.web.tsx`: an `iframe` with `srcdoc` and `sandbox="allow-scripts"` (no same origin with Paseo), the same CSP, messages by `postMessage` checked against the frame's `contentWindow`. The sandbox gives the page no storage: `localStorage` throws on the web, and the reference says so. The office does not use it on the web; it keeps `world-frame.web.ts`.                                                                                                                                                                                                                                                                                                                                                                                 |
| Detection       | A plugin checks `"ScriptFrame" in ui`. The store app and older apps do not have it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Docs            | A `ScriptFrame` section in `public-docs/plugins/reference.md`: what the page may and may not do, the messages, and detection (`"ScriptFrame" in ui`). Detection, because no version guarantees `ScriptFrame`: the fork's app carries upstream's version. `docs/plugins.md` links to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### The office on Android

| Question             | Decision                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offered              | On native, 3D is in the view switch when `ScriptFrame` is there. Whether the phone can draw it is found in the page: no WebGL2 makes the scene report a problem, and the office gives way to 2D under the existing banner with Try again.                                                                                                                   |
| The bridge           | `client/world/world-bridge.ts` gives the view a `WorldApi` over messages. A call is `{ "call": name, "args": [...] }`. `start` sends its options without the callbacks plus the names of those given; the page's stand-ins post `{ "callback": name, "args": [...] }` and the bridge calls the real one. `stop` sends its message, then the frame unmounts. |
| The page's side      | `client/world/world-bridge-page.ts`: a script put before the scene's own in the same frame. It calls `PaseoOfficeWorld` for each message. A scene script that throws, or no `PaseoOfficeWorld` of `WORLD_API_VERSION`, posts `{ "problem": message }`, shown as any other failure.                                                                          |
| The view             | `world-view.tsx`'s feeding of the scene (sessions, events, board rows, the machine, incidents, the theme, the selection) moves into a hook, `useWorldFeed(api)`. `world-view.tsx` keeps its web frame; `world-view.native.tsx` renders `ScriptFrame` with the bridge.                                                                                       |
| Photo mode           | Hidden: the native view starts the scene with `host.photo === false`, since a WebView cannot keep a download.                                                                                                                                                                                                                                               |
| Walk in, Full screen | Hidden by their existing rules (no fine pointer; `fullscreenEnabled` false).                                                                                                                                                                                                                                                                                |
| Brand logo           | Passed only when it is a `data:` URL; otherwise the sign shows the brand's name alone.                                                                                                                                                                                                                                                                      |
| Keys                 | `focusApp` does nothing on native; the page does not take the app's keys.                                                                                                                                                                                                                                                                                   |
| Graphics             | No new setting: the loop's `adaptResolution`. A phone that is still too slow is a follow-up.                                                                                                                                                                                                                                                                |
| Beside the floor     | The session, Sessions, Activity and Chat open as their own screens on a phone, as they do today.                                                                                                                                                                                                                                                            |

### The fork's app

| Question        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The variant     | `fork` in `packages/app/app.config.js`: name "Paseo Fork", package `sh.paseo.fork`, no Firebase file. It installs beside the store app with its own pairing. Push notifications do not work in it.                                                                                                                                                                                                                                                                                                                                                                                                |
| The build       | `npm run build:apk:fork`: `scripts/build-apk.mjs` gains a `fork` target with `APP_VARIANT=fork`, arm64 only, the same steps, then `zipalign` and `apksigner` from the SDK's build tools re-sign the APK with the fork's key. Output: `artifacts/paseo-fork-arm64.apk`. The generated Gradle files are not changed.                                                                                                                                                                                                                                                                                |
| The key         | Made once with `keytool` at `~/.paseo-fork/release.keystore`, its password in `~/.paseo-fork/release.password` (mode 0600). Outside the repo, never committed. Android installs an update only with the same key, so `docs/android.md` says to back up `~/.paseo-fork/`; a lost key means uninstalling the app.                                                                                                                                                                                                                                                                                   |
| Toolchain       | Installed once under the home folder, no system changes: Java 21 (Temurin) in `~/.local/jdk-21`; Android command-line tools, platform 35, build tools 35 and the NDK the React Native version asks for, in `~/Android/Sdk`. About 8 GB with Gradle's cache. `docs/android.md` gains a short "Linux without mise" section.                                                                                                                                                                                                                                                                         |
| Where it builds | The owner's call after the plan: this host is aarch64, and Google's Linux build tools, NDK and `hermesc` are x86_64 only. A workflow on the fork, `.github/workflows/fork-android-apk.yml`, builds on push of a `fork-android-*` tag (or a dispatch for an existing tag) on GitHub's x86 runner, signs with the key from the repository secrets `FORK_ANDROID_KEYSTORE` (base64) and `FORK_ANDROID_KEYSTORE_PASSWORD`, verifies, and attaches the APK to the tag's prerelease. The key is made here once; its copy in `~/.paseo-fork/` stays the backup. The local toolchain install is not done. |
| Shipping        | Pushing the tag is the upload: it happens only after the owner's yes. A prerelease on `allrested/paseo`, tagged `fork-android-<version>-<n>` (e.g. `fork-android-0.16.0-1`), with the APK. Uploaded only after the owner says yes for that upload.                                                                                                                                                                                                                                                                                                                                                |

## Components

- `packages/plugin/src/client/ui.ts`: `ScriptFrame`, `ScriptFrameProps`, `ScriptFrameHandle`.
- `packages/app/src/plugins/react-native/script-frame.native.tsx`, `script-frame.web.tsx`, and the
  export in `react-native/ui.ts`.
- `public-docs/plugins/reference.md`, `docs/plugins.md`: the component.
- `plugins/office/client/world/world-bridge.ts`, `world-bridge-page.ts`, `use-world-feed.ts`,
  `world-view.native.tsx`; `world-view.tsx` uses the hook.
- `plugins/office/client/office-surface.tsx`: 3D offered on native with `ScriptFrame`.
- `packages/app/app.config.js`: the `fork` variant.
- `scripts/build-apk.mjs`, `package.json`: the `fork` target and `build:apk:fork`.
- `docs/android.md`: the fork's app, its key, the Linux toolchain.

## Errors

- A page that cannot start: `onError`, and the office's banner with Try again.
- A lost WebGL context: the scene's own `problem`, as on the web.
- A build without the key: the script stops and says where the key should be and how to make it.

## Not built

- iOS, a Play Store listing, automatic updates, push notifications in the fork's app.
- A graphics setting for phones.
- `ScriptFrame` in other plugins.

## Testing

Unit and mounted: `ScriptFrame` on Android with a fake WebView (its settings, the first load only,
the queue, both directions) and on the web in the test DOM with a real page; the bridge against a
fake frame (calls in order, the queue, callbacks, a problem); the page's script with a stand-in
scene; `world-view.native.tsx` with `ScriptFrame` faked; `office-surface` offering 3D on native
only with `ScriptFrame`; `app.config.js` giving `sh.paseo.fork` for `fork`.

Build: `npm run build:apk:fork` makes a signed arm64 APK; `apksigner verify` passes with the fork's
key; `aapt2 dump badging` shows `sh.paseo.fork` and "Paseo Fork".

On the phone, by the owner, with Paseo's Android tools for screenshots where a device is reachable:
install beside the store app, pair, open the office in 3D, pan with one finger, pinch and twist with
two, tap a person and Open session, a view button and zoom, the incident banner, and how smooth it
is. The daemon's log is watched for errors meanwhile.
