import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
        // Emit ESM so Electron's new ES-module loader (used when
        // sandbox:false) doesn't error on require().
        vite: {
          build: {
            rollupOptions: {
              output: { format: 'es' },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
