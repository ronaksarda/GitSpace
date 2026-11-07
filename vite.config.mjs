// Builds the React UI in web/ into public/app/app.js + app.css (fixed names; server.js revalidates them).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1000, // MUI + React in one file; it is loaded once and revalidated by etag
    rollupOptions: {
      input: 'web/src/main.jsx',
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app-[name].js',
        assetFileNames: 'app[extname]',
      },
    },
  },
});
