import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createLocalApiMiddleware } from './desktop/localApi';

export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  const env = desktop ? {} : loadEnv(mode, '.', '');

  return {
    base: mode === 'production' ? '/html2svg/' : '/',
    envDir: desktop ? false : '.',
    build: { outDir: desktop ? 'desktop-dist/ui' : 'dist' },
    server: {
      port: 36782,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      {
        name: 'local-api-server',
        configureServer(server) {
          server.middlewares.use(createLocalApiMiddleware());
        },
      },
    ],
    define: {
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(desktop ? '' : env.VITE_GEMINI_API_KEY),
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
