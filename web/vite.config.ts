/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { llmProxy } from './server/llmProxy';

// base './' so the build works from any GitHub Pages sub-path (HashRouter handles routing).
export default defineConfig({
  base: './',
  plugins: [react(), llmProxy()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  server:{
    allowedHosts: ['.ngrok-free.dev']
  }
});
