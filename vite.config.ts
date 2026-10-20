import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const backendUrl = process.env.CROND_BACKEND_URL || 'http://127.0.0.1:8080';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      proxy: {
        // Project service URLs share the origin with Vite; reserve frontend asset paths.
        "^/(?!api(?:[/?]|$)|admin(?:[/?]|$)|src(?:[/?]|$)|assets(?:[/?]|$)|node_modules(?:[/?]|$)|public(?:[/?]|$))[a-z][a-z0-9-]{0,62}(?:[/?]|$)": { target: backendUrl, changeOrigin: false },
        "/api": { target: backendUrl, changeOrigin: false, ws: true },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/backend/**'] },
    },
  };
});
