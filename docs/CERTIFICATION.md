# Orbit Hop: Playables certification checklist

Sources, re-read on 2026-11-04:

- Requirements index: <https://developers.google.com/youtube/gaming/playables/certification/requirements>
- Category pages: `requirements_accessibility`, `requirements_design`, `requirements_i18n_l10n`,
  `requirements_integration`, `requirements_monetization`, `requirements_privacydata`,
  `requirements_stability`, `requirements_trustsafety` (same path prefix).
- SDK reference: <https://developers.google.com/youtube/gaming/playables/reference/sdk>

**About the IDs.** The official pages number their sections but don't give individual
requirements IDs. The IDs below are `<category>-<section>.<n>`, numbered in the order the
requirements appear on each page (for example `INT-4.3` is the third requirement in section 4 of
the Integration page). Levels follow the pages: MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.

**How verified**, in short:

- **unit**: `npm test` (`tests/sim.test.ts`, `tests/platform.test.ts`).
- **bundle**: `npm run check:bundle` (`scripts/check-bundle.mjs`).
- **smoke**: `npm run shots` (`scripts/shots.mjs`). It runs screenshots at 4 sizes, a production
  build smoke test, and two Playables integration checks against a fake SDK that records every
  call: the production build (call order, load before save, language, pause and resume, no
  localStorage) and a scored game over driven by the dev autoplay bot.
- **shots**: the screenshots in `shots/`, reviewed by eye.
- **code**: by inspection of the named file.
- **portal**: a Developer Portal task for Nikola at submission time. The game can't do it.

## Differences between the spec and the official pages

The official pages win wherever they differ from `docs/SPEC.md`. These are the differences and
what the game does about each.

| # | Spec said | Official pages say | What Orbit Hop does |
|---|---|---|---|
| 1 | Also pause on `visibilitychange`. | INT-6.2: MUST NOT use the Page Visibility API (or similar) for pause/resume; only `onPause`/`onResume`. | Inside Playables only the SDK events are used. The `visibilitychange` fallback is registered **only outside Playables** (dev, GitHub Pages). See `src/platform/yt.ts`. |
| 2 | Outside YouTube, fall back to the browser's language. | I18N-1.2: MUST NOT use `navigator.language(s)`. | `navigator.language` is read **only outside Playables**. Inside, `ytgame.system.getLanguage()` is the only source. |
| 3 | Save under 2 KB. | STAB-4.1 MUST < 3 MiB, STAB-4.2 SHOULD < 500 KiB, INT-4.6: the exit save is best effort, up to 64 KiB. | The save stays under 2 KB (capped arrays; tested), so every limit is met. |
| 4 | Every file under 512 KiB. | STAB-3.1 MUST < 30 MiB per file; STAB-3.2 SHOULD < 512 KiB. | `check:bundle` enforces 512 KiB as a hard limit. |
| 5 | Initial load well under 1 MB. | STAB-1.1 MUST < 30 MiB initial; STAB-1.2 SHOULD < 15 MiB. | ~21 KiB gzipped in total, and `check:bundle` fails over 1 MB. |
| 6 | `sendScore` with "the endless best, or the daily score". | INT-3.2: the best score sent must match the best score in the save. The SDK says to send one consistent progress dimension. | One dimension: **run score**. Every scored run (every endless run, and the first daily attempt of the day) sends its score; practice runs and zero scores don't. `save.best` is the max of those, so the highest score sent always equals the saved best. Tested in unit and smoke. |
| 7 | `firstFrameReady()` "after the first frame is drawn". | INT-2.1: call `firstFrameReady` while a loading/splash screen shows that loading is underway. | The first frame is a splash (wordmark plus loading dots). `firstFrameReady` fires right after it, and `gameReady` fires after the save and language have loaded and the title is drawn. |
| 8 | Workers, WebAssembly and `eval` "can get a game declined" (third-party guide). | PRIV-7: YouTube *may* decline games it can't evaluate because of them. There's no MUST. | None are used, and `check:bundle` fails on any of them anyway. |
| 9 | (not in spec) | DES-2.6 SHOULD close modals with Esc; DES-2.7 MUST NOT `preventDefault` on Esc. | Esc dismisses the "tap to continue" pause overlay and is never prevented. |
| 10 | (not in spec) | INT-5.7: SHOULD NOT show an overall mute button. | There is no mute button; YouTube's mute and audio setting are honoured. |
| 11 | (not in spec) | PRIV-3.3: MUST NOT show anything resembling a QR code. INT-4.1: save on material progress. | No QR-like graphics. The game saves after every run and on pause. |

## Integration (`requirements_integration`)

| ID | Level | Requirement | How it's met | Verified |
|---|---|---|---|---|
| INT-1.1 | MUST | Load the Playables SDK before any other game code. | `<script src="https://www.youtube.com/game_api/v1">` is the first `<script>` in `index.html`, before the module script. The SDK isn't bundled. | bundle (checks it's the first script in `dist/index.html`) |
| INT-2.1 | MUST | Call `firstFrameReady` while showing a loading or splash screen. | `boot()` draws a splash frame, then calls `platform.firstFrameReady()`. | smoke (call order), code `src/main.ts` |
| INT-2.2 | MUST | Call `gameReady` once the game is ready for interaction. | Called once the title screen (which is the interactive "hold to play" state) is drawn. | smoke (call order) |
| INT-2.3 | MUST NOT | Call `gameReady` while non-interactable splash or loading screens show. | `gameReady` comes after `loadData` and `getLanguage` resolve and the title renders. The adapter enforces `firstFrameReady` → `gameReady`, once each. | unit ("calls firstFrameReady before gameReady"), smoke |
| INT-3.1 | MAY | Use `sendScore`. | Used on game over for scored runs. | smoke |
| INT-3.2 | MUST | Follow the `sendScore` spec, and make the best score sent match the best score in the save. | Integer only, clamped to `MAX_SAFE_INTEGER`. `save.best` = max over sent scores (see difference 6). | unit ("best always equals the highest scored run", "sends integer scores"), smoke ("saved best matches the sent score") |
| INT-4.1 | MUST | Call `saveData` on material progress. | `saveData` runs after every finished run (best, daily result, stats) and on mode change. | smoke |
| INT-4.2 | MUST NOT | Use any other mechanism to save progress. | Inside Playables the adapter never touches localStorage. The localStorage fallback runs only outside Playables. | unit ("never uses storage"), smoke (`localStorage.length === 0`) |
| INT-4.3 | MUST | Await `loadData` before `saveData`. | `loadData` runs once at boot. Every `saveData` call is chained after the load promise in the adapter. | unit ("awaits loadData before saveData", "loads before saving"), smoke |
| INT-4.4 | MUST | Read cloud saves from earlier versions without errors. | `parseSave` never throws: empty, corrupt or hostile data becomes a fresh save, a v0 save migrates, and unknown fields are dropped. | unit ("migrates empty, corrupt and hostile input", "migrates a v0 save") |
| INT-4.5 | SHOULD | Keep progress across versions. | Versioned schema (`v: 1`) with a migration path. | unit |
| INT-4.6 | SHOULD | Auto-save at milestones (exit save is best effort, ≤ 64 KiB). | Saves at every game over and on pause. The save is < 2 KB. | unit ("stays under 2 KB") |
| INT-5.1 | MUST | Respect the system audio setting and mute button. | Standard WebAudio output that follows the OS and device mute. | code `src/audio/synth.ts` |
| INT-5.2 | MUST | Respect YouTube audio via `isAudioEnabled` and `onAudioEnabledChange`. | `synth.setEnabled(isAudioEnabled())` at boot, and updates from `onAudioEnabledChange`. When disabled, the master gain is 0, the context is suspended, and every play call returns early. | code; smoke (fake SDK reports audio off, and no errors) |
| INT-5.3 | MUST | Respect device volume. | Plain WebAudio output, so the device volume applies. | code |
| INT-5.4 | MUST NOT | Play sound unexpectedly. | The AudioContext is created on the first press. The drone and sounds only follow player input. | code |
| INT-5.5 | MUST | When YouTube mute is set, output no audio, and game controls can't override it. | There are no in-game audio controls. Disabled means silent (see INT-5.2). | code |
| INT-5.6 | MAY | Game audio controls when not muted. | None. | n/a |
| INT-5.7 | SHOULD NOT | Show an in-game overall mute button. | None. | shots |
| INT-5.8 | MAY | Granular audio controls. | None. | n/a |
| INT-6.1 | MUST | After `onPause`, pause everything (loop, music, input, network, rendering) until `onResume`. | `pause()` cancels the rAF loop, freezes the sim, suspends the AudioContext, drops any charge in progress, resets input, and saves. `onResume` shows "tap to continue" and the sim only resumes on a tap. | smoke (`playables-paused.png` / `playables-resumed.png`), code `src/main.ts` |
| INT-6.2 | MUST NOT | Use the Page Visibility API (or similar) for pause/resume. | Only used outside Playables (difference 1). | unit ("pauses on visibilitychange outside Playables"), code |
| INT-6.3 | SHOULD | Save progress on `onPause`. | `pause()` calls `saveData`. | smoke (`saveData` after the pause callback) |

## Stability and performance (`requirements_stability`)

| ID | Level | Requirement | How it's met | Verified |
|---|---|---|---|---|
| STAB-1.1 | MUST | Initial bundle < 30 MiB. | ~57 KiB raw, ~21 KiB gzipped, in 2 files. | bundle |
| STAB-1.2 | SHOULD | Initial bundle < 15 MiB. | As above. | bundle |
| STAB-2.1 | MUST | Total bundle < 250 MiB. | As above. | bundle |
| STAB-2.2 | SHOULD | Lazy-load what isn't needed at first. | Everything is needed at first, and it's tiny. Dev-only code is excluded from the build. | bundle (fails if dev code leaks) |
| STAB-3.1 | MUST | Every file < 30 MiB. | The largest file is ~56 KiB. | bundle |
| STAB-3.2 | SHOULD | Every file < 512 KiB. | Enforced as a hard limit. | bundle |
| STAB-4.1 | MUST | Saved game < 3 MiB. | < 2 KB. | unit |
| STAB-4.2 | SHOULD | Saved game < 500 KiB. | < 2 KB. | unit |
| STAB-5.1 | SHOULD | Interactive in under 5 s. | 21 KiB, no assets to fetch. Interactive as soon as `loadData` resolves. | smoke (ready in < 1 s locally) |
| STAB-6.1 | MUST NOT | Reproducible crashes. | Pure sim with fuzzed inputs in tests. Bot runs cover thousands of hops. Errors are reported via `health.logError`. | unit, bot, smoke (fails on any console error or page error) |
| STAB-6.2 | MUST NOT | Peak JS heap > 512 MB. | Fixed-size pools for particles, rings and floaters. World bodies and dust are recycled behind the camera (bounded arrays, tested), and the planet sprite cache is LRU-capped at 48. | unit ("keeps world arrays bounded"), code |
| STAB-6.3 | MUST NOT | Crash the YouTube app, site or other software. | Canvas 2D only; DPR capped at 2. | code |
| STAB-7.1 | MUST | Standards-compliant web APIs. | Canvas 2D and WebAudio, nothing else. | code |
| STAB-7.2 | MUST | Work in all browsers YouTube supports. | ES2020 target, no experimental APIs. Optional APIs (`letterSpacing`, `visualViewport`, `matchMedia`) are feature-guarded, and there's a `webkitAudioContext` fallback. | code; smoke (Chromium) |
| STAB-7.3 | MUST | Work in the YouTube app on Android and iOS. | Touch input via Pointer Events, `touch-action: none`, safe-area insets, and no orientation lock. | shots (phone sizes); **needs a device test in the Playables test suite** |
| STAB-8.1 | MUST | Only relative paths to bundle files. | Vite `base: './'`. | bundle |
| STAB-8.2 | MUST NOT | Absolute paths. | None, apart from the SDK URL, which is required. | bundle |
| STAB-9.1 | MUST | File names only `[A-Za-z0-9_.-]`. | `game-<hash>.js`, `index.html`. | bundle |
| STAB-10.1 | MUST | ≤ 8000 files. | 2 files. | bundle |

## Design (`requirements_design`)

| ID | Level | Requirement | How it's met | Verified |
|---|---|---|---|---|
| DES-1.1 | MUST | Responsive: playable at all aspect ratios, adapting on viewport change. | The camera fits the play column horizontally and keeps a minimum world height visible. UI is laid out from the viewport size, and resizing keeps the game state. | shots (390×844, 844×390, 1280×720, 800×800, plus a live resize in the prod smoke test) |
| DES-1.2 | SHOULD | Fill the viewport. | The starfield and background always fill it; the play column is centred. | shots |
| DES-1.2a | MUST | If not filling, centre with pillar/letterbox. | The column is centred and the sides show the starfield, darkened to mark the bounds. | shots |
| DES-1.3 | MUST NOT | Lock orientation or posture. | No orientation lock anywhere. | code |
| DES-1.4 | MUST | Keep state on resize. | `resize()` only updates the canvas and camera. | smoke (`prod-resized-900x420.png`) |
| DES-2.1 | MUST | Touch input for everything. | Pointer Events: hold and release, the mode chip, retry, continue. | code; shots |
| DES-2.2 | MUST | Mouse input for everything. | Same Pointer Events path. | smoke (mouse press and release in the prod build) |
| DES-2.3 | MUST NOT | Delay or ignore input. | Edges are queued, so even a sub-frame tap registers. The sim consumes an edge on the next 120 Hz tick. The only lockout is a 0.35 s guard on the game-over screen against accidental retries while mashing. | code `src/platform/input.ts` |
| DES-2.4 | MUST NOT | UI errors or unexpected behaviour. | Smoke test fails on any console or page error. | smoke |
| DES-2.5 | SHOULD | Keyboard for directional/text input. | Space, Enter, W and ↑ to hold; ← and → (or M) to switch mode. | code |
| DES-2.6 | SHOULD | Esc closes modals. | Esc dismisses the "tap to continue" overlay. | code |
| DES-2.7 | MUST NOT | `preventDefault` on Esc. | The Esc branch returns before any `preventDefault`. | code `src/platform/input.ts` |
| DES-2.8 / 2.8a | MAY / MUST | Haptics, with a toggle if used. | No haptics. | n/a |
| DES-3.1 | MUST | Crisp text and graphics at every resolution and density. | Canvas backing store at devicePixelRatio (capped at 2). Planet sprites are rendered at the current pixel scale. All text is live canvas text in the system font. | shots |
| DES-4.1 | MUST | All required portal metadata. | Draft text in `docs/APPLICATION.md`. | **portal** |
| DES-4.2 | MUST NOT | Branding or logos in thumbnails, description or title. | The thumbnail should be a clean gameplay shot. | **portal** |
| DES-5.1 | MUST | Communicate when there's no more content. | Endless game. Every run ends on a clear game-over screen with the score and one-tap retry, and the daily shows "Practice" after the scored attempt. | shots |
| DES-6.1 | MUST NOT | In-game sharing prompts. | None. | shots |
| DES-6.2 | MUST NOT | Clickable external links. | None. The bundle check fails on any absolute URL. | bundle |
| DES-6.3 | MUST NOT | Extra user agreement. | None. | shots |
| DES-6.4 | MUST NOT | Icons mimicking Playables actions near them. | The HUD is centred text only, with no icons in the corners. | shots |
| DES-6.4a | MUST NOT | In-game exit/quit button. | None. | shots |

## Internationalisation (`requirements_i18n_l10n`)

| ID | Level | Requirement | How it's met | Verified |
|---|---|---|---|---|
| I18N-1.1 | MAY | Use `getLanguage` for the locale. | `pickLang(await getLanguage())`, with en, de, fr, it and es shipped. | unit, smoke (fake SDK `fr-FR` → `lang="fr"`) |
| I18N-1.2 | MUST NOT | Use `navigator.language(s)`. | Only outside Playables (difference 1). | code `src/platform/yt.ts` |
| I18N-2.1 | MUST | Support English. | English is the default and the fallback for every key. | unit |

## Privacy and data (`requirements_privacydata`)

| ID | Level | Requirement | How it's met | Verified |
|---|---|---|---|---|
| PRIV-1.1 | MUST | Follow the Google Privacy Policy. | No personal data is collected or stored. The save holds scores, stats and the last mode. | code |
| PRIV-3.1 | MUST NOT | External calls except required Google/YouTube APIs. | The only external request is the SDK script. No fetch, XHR, beacon or WebSocket in the bundle. | bundle (fails on network APIs), smoke (fails on any request other than the page origin and the SDK) |
| PRIV-3.2 | MUST NOT | Circumvent external call prevention. | No. | code |
| PRIV-3.3 | MUST NOT | QR-like graphics. | None. | shots |
| PRIV-4.1 | MUST NOT | Clipboard access without a paste action. | No clipboard use. | code |
| PRIV-4.2a | MUST NOT | Ask for or collect personal information. | No text input at all. | code |
| PRIV-4.2b | MUST NOT | Login or account-creation-like screens. | None. | shots |
| PRIV-5.1 | MUST NOT | Obfuscate code. | Standard Vite/esbuild minification only, which the page explicitly allows. | bundle |
| PRIV-6 / 7 | (no level) | Code size and complexity limits; Wasm, `eval` and workers may be declined. | ~57 KiB of plain JS. None of those features are used. | bundle |
| PRIV-8.1 | MUST | Single-page app. | One `index.html` and one script. | bundle |

## Monetisation (`requirements_monetization`)

v1 has **no ads and no purchases**. The adapter has an off-by-default hook
(`ADS_ENABLED = false`, `maybeInterstitial` every 3rd game over), called only on the transition
to the game-over screen.

| ID | Level | Requirement | How it's met | Verified |
|---|---|---|---|---|
| MON-1.1–1.4 | MUST / MUST NOT | No off-platform monetisation, and rewards have only in-game value and aren't transferable. | No monetisation, rewards or items. | code |
| MON-2.1 | MAY | YouTube in-game ads. | Hook exists, off. | unit ("no ads in v1"), smoke (fails if `ad` is called) |
| MON-2.2 / 2.3 | MUST | With ads: still honour audio and pause events. | The same `setEnabled`/`pause` paths would apply. | code |
| MON-2.4 | MUST NOT | Off-platform ads. | None. | bundle |
| MON-2.5 | MUST | With ads: configure monetisation in the portal. | Not applicable while ads are off. | **portal** (v2) |
| MON-2.1.x | MUST / MUST NOT | Rewarded ads must be opt-in, etc. | No rewarded ads. | n/a |
| MON-2.2.x | MUST / MUST NOT | Interstitials only at natural transitions, never during play. | The hook only runs on the death → game-over transition. | code `src/main.ts` |
| MON-3.1 | MUST NOT | Off-platform IAP. | None. | code |
| MON-4.1 | MUST | Advertiser-friendly content if monetised. | Abstract space visuals, no violence or text content. | shots |

## Trust and safety (`requirements_trustsafety`)

| ID | Level | Requirement | How it's met | Verified |
|---|---|---|---|---|
| TS-1.1 | MUST | Follow the Community Guidelines. | Abstract, non-violent arcade game. | shots |
| TS-1.2a | MUST NOT | Target kids or be labelled "made for kids". | Positioned as a general-audience arcade game. | **portal** |
| TS-1.2b | MUST | Suitable for 13+. | Yes. | shots |
| TS-1.3 | (policy) | No misleading titles or thumbnails. | Use real gameplay screenshots. | **portal** |
| TS-2.1 | MUST | Follow the YouTube Developer ToS. | Uses only the public SDK. | code |
| TS-2.2 | MUST / MUST NOT | Cleared IP, original, not a duplicate. | Original design. Every visual and sound is generated at runtime by this code, with no third-party assets, fonts or audio. | code, bundle (2 files: JS and HTML) |
| TS-2.3 | MUST NOT | Trademark or trade-dress infringement. | Original name, look and mechanics. | **portal** (name search before submission) |
| TS-2.4 | MUST | Music rights. | Music is a procedural WebAudio drone written in this repo. | code `src/audio/synth.ts` |
| TS-2.5 | MUST | Personality rights. | No people or likenesses. | n/a |
| TS-3.1 | MUST NOT | Share dev/staging links externally. | Process rule for Nikola. The GitHub Pages demo is a separate public build, not a Playables staging link. | **portal** |

## Accessibility (`requirements_accessibility`)

| ID | Level | Requirement | How it's met | Verified |
|---|---|---|---|---|
| A11Y-1.1 | SHOULD | Best effort toward WCAG AA. | One-button control, with no timing-critical text. Hazards differ from planets by shape (jagged, tumbling rocks; a black disc with swirling rings) and motion, not only colour. The pulsar's open and closed states differ by shape (solid vs. dotted ring) and blink slowly (≥ 1.9 s period, no strobing). Honours `prefers-reduced-motion` (no screen shake or twinkle). High-contrast HUD. | shots, code |
| A11Y-2.1a | SHOULD | Add AGI accessibility tags in the listing. | Suggested tags are in `docs/APPLICATION.md`. | **portal** |
| A11Y-2.1b | MUST NOT | Misrepresent the game with tags. | Only tags the game actually supports are suggested. | **portal** |

## SDK reference notes

- `firstFrameReady()` is required and must come before `gameReady()`. The adapter enforces this.
- `saveData` takes a well-formed UTF-16 string ≤ 3 MiB. Ours is ASCII JSON < 2 KB.
- `sendScore({ value })` takes an integer ≤ `Number.MAX_SAFE_INTEGER`. YouTube shows the highest
  value sent.
- Async SDK calls can reject with `undefined`. Every call in the adapter catches it.
- `onPause` fires on every pause, including exit, and the game may never resume. That's why
  `pause()` saves.
- `health.logError()` takes no arguments. It's called on `window` error and unhandled rejection.
