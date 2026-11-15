import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { emberApiPlugin } from './server/api';

// Let `npm run dev` / `npm run preview` be shared through an ngrok tunnel.
// A leading dot allows every subdomain; any other host is still blocked.
const tunnelHosts = ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.app', '.ngrok.dev'];

export default defineConfig({
  base: './',
  server: { allowedHosts: tunnelHosts },
  preview: { allowedHosts: tunnelHosts },
  plugins: [react(), emberApiPlugin()],
  // Keep hooks and the renderer on one React instance.
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
