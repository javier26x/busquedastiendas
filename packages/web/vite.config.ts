import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // El SDK de Firebase (auth + firestore) ronda los 550 kB sin comprimir;
    // es esperable y ya va en su propio chunk cacheable.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Firebase pesa bastante; separarlo mejora el cacheo entre despliegues.
        manualChunks(id: string) {
          if (/node_modules\/(@firebase|firebase)\//.test(id)) return 'firebase';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
