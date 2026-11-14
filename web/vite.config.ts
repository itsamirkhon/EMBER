/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any GitHub Pages sub-path (HashRouter handles routing).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  server:{
    allowedHosts: ['.ngrok-free.dev']
  }
});
