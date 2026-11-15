# NeuroMove AI 3D

Offline 3D neuro-rehabilitation flight simulator and boss battle with mirrored webcam head tracking and real-time clinical range-of-motion (ROM) telemetry.

## Features

- **100% Standalone Offline Simulation**: Runs completely client-side with WebGL (Three.js) and a 2D perspective fallback.
- **Three Play Modes**:
  - **Tutorial Level**: 5-step guided calibration covering lateral steer, vertical pitch, orb collection, hazard dodging, and ring alignment.
  - **Launch Flight**: Progressive flight course with combo multipliers and automatic **Neuro-Core Overlord** boss trigger at 1,500 points.
  - **Boss Battle**: Direct encounter with the Neuro-Core Overlord—collect Cyan Energy Orbs to fire counter-beams while dodging Red Plasma.
- **Four Difficulty Levels**: Easy, Medium, Hard, and Extreme.
- **Multi-Modal Controls**: Keyboard (`WASD` / `Arrow` keys), Mouse/Pointer steering, or **Mirrored Webcam Head Tracking** (`C` to re-center).
- **Clinical Telemetry**: Live X-ROM, Y-ROM, left/right Symmetry, and post-session Clinical Rehabilitation Report with grading (`S`–`D`).

## Local Development

```bash
npm install
npm run dev
```

## Build & Verify

```bash
npm run lint
npm run build
```

## Deploying to GitHub Pages

1. Push this repository to GitHub on the `main` or `master` branch.
2. In your repository **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The included `.github/workflows/deploy.yml` workflow will automatically run `npm run lint`, `npm run build`, and publish `dist/` to GitHub Pages.
