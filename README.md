# Outpost of Azeroth

An unofficial, non-commercial, fan-made incremental game set in the Warcraft universe. No Blizzard art or text is used; all graphics are original CSS and SVG.

## Run it

```
npm install
npm test            # unit tests
npm run serve       # builds the standalone page and serves it at http://localhost:8080
```

`npm run build` writes `dist/index.html` (the artifact form). `npm run build:pages` writes `docs/index.html`, the standalone page used for GitHub Pages. Notes for each development checkpoint are in `HANDOFF.md`.

## Host it on GitHub Pages

Pick one of the two ways.

**A. Automatic (recommended).** Push this folder to a GitHub repository whose default branch is `main`, then open Settings > Pages and set Source to "GitHub Actions". The workflow in `.github/workflows/pages.yml` runs the tests, builds, and deploys on every push. The game appears at `https://<you>.github.io/<repo>/`.

**B. No build on GitHub.** Run `npm run build:pages`, commit the `docs/` folder, then set Settings > Pages > Source to "Deploy from a branch", branch `main`, folder `/docs`. Rebuild and commit `docs/` after each change.

## On iPhone

Open the page in Safari, tap Share, then Add to Home Screen, to play full screen. Saves live in the browser's local storage for that address; use Settings > Saving > Create export string in the game to back them up, since clearing Safari data (or opening the page from a different address) starts a fresh save.
