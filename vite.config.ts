import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Optional for constrained development environments via DISABLE_HMR.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Skip file watching when DISABLE_HMR is true to reduce CPU use.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
