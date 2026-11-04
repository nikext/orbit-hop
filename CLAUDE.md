# Orbit Hop

An original one-thumb gravity-slingshot arcade game for YouTube Playables.
`docs/SPEC.md` is the source of truth. Read it fully before writing code.

## Working rules
- The official Playables docs beat the spec: re-check the requirements and SDK
  pages at the start of a session and note any difference in
  `docs/CERTIFICATION.md`.
- Keep it dependency-free at runtime. Nothing may make a network request
  except the YouTube SDK script tag.
- Every asset is procedural. Never add image, font, or audio files from
  elsewhere.
- Commit in small, meaningful steps. Work on a branch and open a PR to `main`;
  don't push to `main` directly.
- Don't change repo visibility, publish anywhere, or submit anything to
  YouTube. Nikola does that.
- Before calling something done, run `npm test`, `npm run check:bundle`, and
  `npm run shots`, and look at the screenshots.

## Commands (create these)
- `npm run dev`: local dev server
- `npm test`: vitest
- `npm run bot`: headless difficulty bot
- `npm run check:bundle`: build plus Playables bundle checks
- `npm run shots`: Playwright screenshots at 4 sizes
- `npm run package`: build the Playables zip
