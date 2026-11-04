# Playables interest form: draft answers

Draft answers for Nikola to paste into the YouTube Playables developer interest form. Edit
freely. Numbers are from the v1 build. Items in [brackets] need filling in.

---

**Game title**
Orbit Hop

**One-line pitch**
A one-thumb gravity-slingshot arcade game: hold to charge, release to hop from orbit to orbit,
and chain fast hops up an endless column of planets.

**Game description**
You pilot a small glowing probe orbiting a planet. Hold anywhere to charge a launch, and a dotted
preview shows how gravity will bend the first moment of your flight. Release to fling yourself
out of orbit, then get captured by the next planet. Quick hops build a combo multiplier up to x8.
Skimming a surface without crashing earns a near-miss bonus, and stardust rewards bolder arcs.
As you climb, new things appear: moons that move, gas giants with huge pull, asteroid belts,
pulsars whose capture zones open and close, and black holes you can slingshot around for a big
bonus. A Daily Orbit gives everyone the same seeded run each day, with one scored attempt, and
Endless mode is for chasing your personal best. Runs last from about a minute to a few minutes,
and a restart is a single tap.

**Genre**
Arcade / casual skill (one-button physics)

**Target audience**
General audience, 13+. Not directed at children.

**Target session length**
Single runs: about 20–60 s for a first-time player, and 2–5 min for a practised one, as measured
with a headless bot that models human timing. Typical sessions are several runs back to back.

**Platforms / mobile support**
Built mobile-first for the YouTube app on Android and iOS and for YouTube on desktop web. It
plays at any aspect ratio (portrait, landscape, square, and anything from 9:32 to 32:9), adapts
live to resizes, and never locks orientation. Touch, mouse and keyboard all work. One-thumb
play.

**Controls**
Hold to charge, release to launch. That's the whole game. Keyboard: Space / Enter.

**Languages**
English, German, French, Italian, Spanish (chosen through `ytgame.system.getLanguage()`). The UI
has very little text.

**Tech stack**
TypeScript (strict) and Vite, with zero runtime dependencies. Rendering is Canvas 2D with
procedurally generated sprites (no images), and audio is procedural WebAudio synthesis (no audio
files). The simulation is deterministic and fixed-timestep (120 Hz) with interpolated rendering.
Tested with Vitest, plus a headless difficulty and reachability bot, and Playwright screenshot and
integration smoke tests. No Web Workers, WebAssembly or `eval`, and no network requests other
than the Playables SDK script.

**Bundle size**
About 57 KiB total (about 21 KiB gzipped), in 2 files (`index.html` and one JS file). No assets
to download.

**SDK integration status**
Integrated and tested against a recording mock of the SDK. Integration covers:
- SDK loaded first in `index.html`, never bundled.
- `firstFrameReady()` on the splash frame, and `gameReady()` once the title screen is
  interactive.
- `loadData()` at boot, with every `saveData()` chained after it. The save is versioned JSON
  under 2 KB, with migration from empty, corrupt or older saves.
- `sendScore()` on each scored run, so the saved best always equals the highest score sent.
- `getLanguage()`, `isAudioEnabled()` and `onAudioEnabledChange()`.
- `onPause()` and `onResume()`. Pause freezes everything and saves, and resume shows a "tap to
  continue" overlay.
- Ads: an off-by-default interstitial hook for a later version. None in v1.

Not yet run in the official Playables test suite or on physical devices inside the YouTube app.
That's the next step once access is granted.

**Monetisation plans**
None in v1. A possible later version adds YouTube interstitials at natural break points (game
over, every few runs) and purely cosmetic probe trails unlocked with stardust. No purchases.

**Content and IP**
Fully original design and code. Every visual and sound is generated at runtime by the game's own
code, with no third-party art, fonts, music or sound effects. No user data is collected, there's
no text input, and there are no external links, sharing prompts or logins.

**Accessibility**
One-button control. Hazards differ from planets by shape and motion as well as colour
(colour-blind-safe). No strobing (the pulsar blinks slowly). Honours `prefers-reduced-motion`.
Suggested AGI tags (check against the portal's list): one-button / simple controls, no reading
required, colour-blind friendly, no flashing lights.

**Demo URL**
[GitHub Pages URL once the repository is public, e.g. https://nikext.github.io/orbit-hop/]

**Source / developer**
[Nikola, contact email, YouTube channel]

**Anything else**
The repository includes a requirement-by-requirement certification checklist
(`docs/CERTIFICATION.md`) that maps each official requirement to how it's met and how it was
verified.
