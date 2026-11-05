import { appStore } from './app/store.ts';
import { Router } from './app/router.ts';
import { LandingScreen } from './app/screens/landing.ts';
import { GuideScreen } from './app/screens/guide.ts';
import { SetupScreen } from './app/screens/setup.ts';
import { StageScreen } from './app/screens/stage.ts';
import { audioEngine } from './audio/engine.ts';

// Connect audio engine to store: "The audio engine reads from the store. Never let UI code talk to the audio engine directly."
appStore.subscribe((state) => {
  audioEngine.syncWithStore(state);
});

const appContainer = document.getElementById('app');

if (!appContainer) {
  throw new Error('Root #app container not found');
}

const router = new Router(appContainer);

router.register('landing', new LandingScreen());
router.register('guide', new GuideScreen());
router.register('setup', new SetupScreen());
router.register('stage', new StageScreen());

router.init();

// Global keyboard handler for Escape (closes overlays) and Stage keys
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    const state = appStore.getState();
    if (state.overlays.showGestures) {
      appStore.setGesturesOverlay(false);
    }
    if (state.overlays.showTuning) {
      appStore.setTuningPanel(false);
    }
  }
});
