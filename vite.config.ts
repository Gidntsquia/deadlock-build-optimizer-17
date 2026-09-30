import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built app works from any folder or sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { host: true },
  preview: { host: true },
});
