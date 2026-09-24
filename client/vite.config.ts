import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, '..');

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // Запросы к API уходят на сервер Express, чтобы в дев-режиме не было CORS.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
    // Разрешаем читать общий каталог shared, лежащий уровнем выше клиента.
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
