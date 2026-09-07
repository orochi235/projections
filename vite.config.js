import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/projections/' : '/',
  plugins: [react()],
  server: { host: '::', port: 5173 },
}));
