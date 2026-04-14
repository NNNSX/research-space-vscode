import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.tsx'),
      name: 'ResearchSpace',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    outDir: '../dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      // vscode API is provided by the extension host — exclude it
      external: [],
      output: {
        // IIFE — everything bundled into one file
        inlineDynamicImports: true,
      },
    },
    sourcemap: true,
    minify: false,  // Keep readable for debugging
  },
  define: {
    // Mermaid uses process.env in some paths
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
