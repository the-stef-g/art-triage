import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation giver SharedArrayBuffer, som goer WASM-inferensen
// multitraadet. I produktion saetter app://-protokollen samme headers.
function coiHeaders() {
  return {
    name: 'coi-headers',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), coiHeaders()],
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    outDir: 'dist',
    target: 'chrome120',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: {
        index: 'index.html',
        ai: 'ai.html',
      },
    },
  },
});
