import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' makes dist/index.html loadable from any path or subfolder on a static host.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
