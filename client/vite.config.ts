import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  /*
   * The repo keeps one `.env` at the root; there is no `client/.env`. Without
   * this, Vite would look only in this directory, find nothing, and silently
   * fall back for every VITE_* value.
   */
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    // The non-Docker dev path: Vite proxies /api so the browser still sees a
    // single origin and the auth cookies stay first-party, exactly as they do
    // behind nginx in Compose.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
