# Deckhand

Browser DJ mixer controlled by hand gestures through the webcam.

## Overview

Deckhand is a client-side DJ mixer featuring two decks, a crossfader, 3-band EQ, tempo control for beat matching, smart beat grid alignment, and mix recording (audio and optional video compositor). All audio processing and computer vision run entirely on the client device inside the browser tab using Web Audio API and MediaPipe HandLandmarker.

## Requirements

- Node.js (v18+)
- Modern desktop browser (Google Chrome recommended; Firefox and Safari supported with standard Web Audio / MediaPipe fallbacks)
- Webcam

## Setup & Running

```bash
# Install dependencies (pins exact versions, scripts ignored)
npm install --ignore-scripts

# Copy MediaPipe WASM and runtime assets to public directory
npm run copy-wasm

# Run Vite local development server
npm run dev

# Run unit test suite (Vitest)
npm test

# Build production bundle for deployment
npm run build
```

## Deployment to Cloudflare Pages

The production output directory is `dist/`.

To deploy to Cloudflare Pages:
1. Build the production assets: `npm run build`
2. Connect your repository to Cloudflare Pages or deploy `dist/` directly via Wrangler / Cloudflare Dashboard.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Security headers and strict Content Security Policy are pre-configured in `public/_headers` (copied automatically into `dist/_headers`).

## Controls Summary

### Hand Gestures
- **Volume**: Thumb touches index fingertip (move up or down)
- **Bass**: Thumb touches middle fingertip (move up or down)
- **Mid**: Thumb touches ring fingertip (move up or down)
- **Treble**: Thumb touches pinky fingertip (move up or down)
- **Tempo**: Peace sign with index and middle fingers up (move up or down)
- **Crossfader**: Point with index finger, either hand (slide left or right)
- **Play or pause**: Hold thumbs up for 500 ms
- **Cue**: Hold fist for 500 ms
- **Reset to default**: Double pinch/point/peace quickly without moving (< 350 ms, gap < 600 ms)
- **Gestures help overlay**: Raise both open palms in upper 60% of frame for 1200 ms

### Keyboard Shortcuts
- `1`: Sync deck A
- `2`: Sync deck B
- `Q`: Deck A slower (nudge)
- `W`: Deck A faster (nudge)
- `O`: Deck B slower (nudge)
- `P`: Deck B faster (nudge)
- `M`: Mute or unmute
- `R`: Start or stop recording
- `T`: Tuning panel
- `H`: Gestures list
- `Escape`: Close any active overlay
