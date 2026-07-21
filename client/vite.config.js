import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  css: {
    // Dart Sass 2.0 drops the legacy JS API; opt into the modern compiler now.
    preprocessorOptions: { scss: { api: 'modern' } },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3017', changeOrigin: true },
      '/sessions': { target: 'ws://localhost:3017', ws: true },
    },
  },
});
