// Bridge for the test hook installed by the renderer (see src/App.tsx).
// Mirrors the augmentation in the app code so Playwright callbacks typecheck.
export {};

declare global {
  interface Window {
    __loopflow?: {
      reset: () => void;
      getState: () => unknown;
    };
  }
}
