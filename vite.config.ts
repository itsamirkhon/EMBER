import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { emberApiPlugin } from './server/api';

export default defineConfig({
  base: './',
  plugins: [react(), emberApiPlugin()],
  // Keep hooks and the renderer on one React instance.
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
