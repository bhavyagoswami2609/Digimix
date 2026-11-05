import { appStore, ScreenId } from './store.ts';

export interface ScreenComponent {
  mount(container: HTMLElement): void;
  unmount(): void;
}

export class Router {
  private container: HTMLElement;
  private screens: Map<ScreenId, ScreenComponent> = new Map();
  private activeScreenId: ScreenId | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  register(screenId: ScreenId, component: ScreenComponent) {
    this.screens.set(screenId, component);
  }

  init() {
    this.unsubscribe = appStore.subscribe((state) => {
      if (state.currentScreen !== this.activeScreenId) {
        this.renderScreen(state.currentScreen);
      }
    });
    this.renderScreen(appStore.getState().currentScreen);
  }

  private renderScreen(screenId: ScreenId) {
    if (this.activeScreenId && this.screens.has(this.activeScreenId)) {
      this.screens.get(this.activeScreenId)!.unmount();
    }

    this.container.innerHTML = '';
    this.activeScreenId = screenId;

    const next = this.screens.get(screenId);
    if (next) {
      next.mount(this.container);
    }
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.activeScreenId && this.screens.has(this.activeScreenId)) {
      this.screens.get(this.activeScreenId)!.unmount();
    }
  }
}
