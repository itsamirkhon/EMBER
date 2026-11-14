import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { emberApiPlugin } from './server/api';

export default defineConfig({
  base: './',
  plugins: [react(), emberApiPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
