# Orbit Hop: spec

An original one-thumb arcade game built for **YouTube Playables**. It is the
demo that goes with Nikola's application for Playables developer access, so it
has to pass Google's certification checklist on the first try and feel
polished within 10 seconds of play.

## 1. The game

You are a small glowing probe orbiting a planet.

- **Hold** (touch, mouse button, or Space) to charge a launch. A dotted
  trajectory preview shows the first ~0.6 s of flight, so aiming is readable
  but not solved for you.
- **Release** to leave the orbit tangentially, at a speed set by the charge.
- In flight, every planet pulls you with simplified gravity. When you pass
  close enough to a planet that isn't your previous one, you are **captured**
  into a stable orbit around it.
- Leaving the play area, hitting a planet's surface, or touching a hazard ends
  the run.
- The camera scrolls upward (or "forward") as you progress. The world is an
  endless, procedurally generated vertical column of planets.

### Scoring
- +100 per new planet captured.
- **Combo:** a capture within 2.0 s of the previous capture (time spent
  orbiting counts, not just the flight) multiplies the next capture (x2, x3,
  … up to x8). Combos reset on a slow hop. The HUD's combo pill drains to
  show the time left. (Changed from "1.5 s of launching" after bot tuning:
  counting only flight time let ~77% of captures keep a combo by accident.)
- **Near-miss bonus:** skimming within a small band of a planet's surface
  without crashing gives +25 and a sound and visual flourish.
- **Stardust:** small pickups along slingshot paths, +10 each, which reward
  ambitious trajectories.

### Variety (introduced gradually, by distance)
1. Plain planets (sizes and masses vary).
2. Moons that orbit planets, which are moving capture targets.
3. Gas giants: large, strong pull, and they capture from further out.
4. Asteroid belts (hazards) between planets.
5. Pulsars: planets whose capture zone blinks on and off.
6. Black holes: no capture, a strong pull, and a big slingshot bonus if you
   pass through the outer ring and survive.

The difficulty curve is gentle for the first 30 s. The first death should
typically come after 20–60 s for a new player, and runs should top out at
3–5 minutes for good players.

### Modes
- **Daily orbit:** a seeded run (seed = UTC date) that is the same for
  everyone. One scored attempt counts as "today's best", and further attempts
  are practice. Shows "Daily #N".
- **Endless:** a random seed, where you chase your personal best.

### Feel (most important)
- Input-to-response under one frame. Charging has a rising audio tone and the
  probe squashes visibly.
- A capture gives a short time-dilation (~120 ms at 30% speed), a ring burst,
  a pitched chime that climbs with the combo, and light screen shake.
- Death plays a satisfying break-apart particle effect, then the restart is
  **one tap** and takes under 1 s. No menus between runs.
- 60 fps on a mid-range phone. Fixed-timestep simulation (e.g. 120 Hz) with
  interpolated rendering.

### Look
- Everything is **procedural**: no image, font, or audio files beyond what's
  generated at runtime. That keeps the bundle tiny and clears any
  asset-rights questions.
- Rendering: **Canvas 2D** (not WebGL, which keeps it lean and robust on
  low-end devices). Neon-on-deep-space palette, additive glow via pre-rendered
  offscreen sprites (generated at boot), and a parallax starfield in 3 layers.
- Planets get procedural banding, craters, and atmosphere halos from a seeded
  RNG.
- UI text uses the system font stack. No webfonts (no external calls).
- Both light-sensitive and colour-blind-safe: hazards differ from planets by
  shape and motion, not only by colour.

### Audio
- Procedural **WebAudio** only: synth chimes on a pentatonic scale for
  captures, a filtered-noise whoosh for launches, a soft generative drone pad
  for the background.
- Honour `ytgame.system.isAudioEnabled()` and `onAudioEnabledChange`, and
  never play sound when audio is disabled. Resume the AudioContext on first
  user gesture.

## 2. YouTube Playables requirements (MUST pass)

Sources: <https://developers.google.com/youtube/gaming/playables/certification/requirements>,
<https://developers.google.com/youtube/gaming/playables/reference/sdk>.
Re-read both at the start of the session, because they change. Where they
differ from this spec, the official pages win; record the difference in
`docs/CERTIFICATION.md`.

- **SDK:** `<script src="https://www.youtube.com/game_api/v1"></script>` is the
  first script in `index.html`, before any game code. Wrap every call in a thin
  `src/platform/yt.ts` adapter that also works outside YouTube (local dev,
  GitHub Pages demo): check `typeof ytgame !== "undefined" && ytgame.IN_PLAYABLES_ENV`.
  Outside YouTube the adapter falls back to localStorage for saves and to the
  browser's language for locale. The SDK must not be bundled; it is loaded
  from that URL.
- `ytgame.game.firstFrameReady()` after the first frame is drawn, and
  `ytgame.game.gameReady()` once the player can interact (the title/tap-to-start
  screen counts as interactive; a loading bar doesn't).
- **Saves:** `loadData()` once at boot **before** any `saveData()`. Save a
  small versioned JSON string with best scores, daily results, settings, and
  stats, keeping it under 2 KB. Never use localStorage inside Playables.
- **Scores:** `engagement.sendScore({ value })` with an integer on game over
  (the endless best, or the daily score).
- **Pause:** `system.onPause` freezes the simulation, audio, and timers;
  `onResume` shows a "tap to continue" overlay (no instant unpause mid-flight).
  Also pause on `visibilitychange`.
- **Language:** `system.getLanguage()`. Ship English plus German, French,
  Italian, and Spanish strings (the UI has very little text). Fall back to
  English.
- **Layout:** works at **any aspect ratio** (portrait phone, landscape
  desktop, square) and any resize. No orientation lock. Touch, mouse, and
  keyboard all work. No hover-only UI. On landscape screens (wider than
  1.2:1) the world view turns a quarter turn so the column runs left to right
  and fills the screen; text and UI stay upright.
- **Bundle:** initial load well under 1 MB (target under 300 KB gzipped);
  every file under 512 KiB; only relative paths (`vite` `base: './'`); file
  names `[A-Za-z0-9_.-]` only; no absolute URLs other than the SDK script.
- **Network:** no external requests at all (no analytics, fonts, or CDNs).
- **No Web Workers, no WebAssembly, no `eval`/`new Function`.** A third-party
  guide says these can get a game declined.
- **No external links, no "share" prompts, no quit button, no login.**
- **Content:** original, suitable for 13+, not directed at children.
- **Stability:** no crashes; the JS heap stays well under 512 MB (target
  under 100 MB); no unbounded arrays (pool particles and recycle planets
  behind the camera).
- **Ads:** none in v1. Leave a hook in the adapter
  (`requestInterstitialAd` every ~3rd game over, off by default) for later.

## 3. Engineering

- **Stack:** Vite + TypeScript (strict), no runtime dependencies. Vitest for
  tests. Playwright (dev only) for screenshots and a smoke test.
- **Structure:**
  - `src/sim/`: a deterministic, headless simulation (seeded PRNG, fixed
    timestep, pure functions where reasonable). No DOM access.
  - `src/render/`: the Canvas 2D renderer, sprites, particles, camera.
  - `src/audio/`: the WebAudio synth.
  - `src/platform/`: the `yt.ts` adapter, input, resize, i18n.
  - `src/main.ts`: boot and the game state machine (title → playing →
    game over → playing).
- **Tests:**
  - Sim determinism: same seed and inputs give the same score.
  - Generation: no impossible gaps. For a range of seeds, a simple bot
    (search over charge levels) can always reach the next planet.
  - Save schema round-trip and migration from an empty or corrupt save.
  - The adapter's fallback when `ytgame` is undefined.
- **Tools:**
  - `npm run bot`: a headless bot plays N seeds and prints distance and
    score distributions. Use it to tune difficulty.
  - `npm run check:bundle`: builds, then fails if any file is over 512 KiB,
    the gzipped total is over 1 MB, any absolute path or forbidden file name
    appears, or `Worker`/`WebAssembly`/`eval(`/`new Function` shows up in the
    output.
  - `npm run shots`: Playwright screenshots at 390×844, 844×390, 1280×720,
    and 800×800 of the title, mid-flight, capture, and game-over states. Use
    URL dev flags like `?seed=42&autoplay&t=12` gated to dev builds only.
- **Demo hosting:** a GitHub Actions workflow that deploys `dist/` to GitHub
  Pages on push to `main`. It only works once the repo is public; Nikola
  decides that, so don't change repo visibility.
- **Packaging:** `npm run package` produces `orbit-hop-playable.zip` (the
  contents of `dist/` at the zip root) for the Playables portal.

## 4. Definition of done (v1)

1. Fun: a cold player understands it without text within 5 s and wants
   "one more run". Verify the feel by reviewing screenshot sequences and
   bot runs. Tune until the bot's median first death is 20–60 s.
2. All tests and `check:bundle` pass, and `npm run build` is clean.
3. Screenshots at all 4 sizes look intentional (no clipped UI).
4. `docs/CERTIFICATION.md` is a table of every official requirement (with its
   ID) → how it is met → how it was verified.
5. `README.md`: pitch, a GIF or screenshot strip, controls, how to run, a
   Playables integration summary, and the bundle size.
6. `docs/APPLICATION.md`: draft answers for the Playables interest form
   (game description, genre, target session length, mobile support, tech
   stack, bundle size, SDK integration status, demo URL placeholder), for
   Nikola to paste.

## 5. Out of scope for v1

Ads, multiplayer, leaderboards beyond `sendScore`, skins/unlockables (a
possible v2: cosmetic trails unlocked by stardust), and any backend.
