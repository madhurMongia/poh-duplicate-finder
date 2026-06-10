import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // `netlify dev` serves the functions on 8888; run it alongside `vite`
      // (or just use `netlify dev` alone, which wraps this dev server).
      '/api': 'http://localhost:8888',
    },
  },
});
