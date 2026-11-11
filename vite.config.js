import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Loaded as classic <script> tags or fetched at runtime, so Vite doesn't bundle them
const STATIC_FILES = ['io.js', 'diagram.js', 'ui.js', 'help-modal.js', 'app.js', 'help-content.html'];

function copyStaticFiles() {
  return {
    name: 'copy-static-files',
    apply: 'build',
    generateBundle() {
      for (const fileName of STATIC_FILES) {
        this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(path.join(ROOT, fileName)) });
      }
    }
  };
}

export default defineConfig({
  root: './',
  plugins: [copyStaticFiles()],
  server: {
    host: '0.0.0.0',
    hmr: true,
    allowedHosts: true,
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: './dist',
    emptyOutDir: true
  }
});
