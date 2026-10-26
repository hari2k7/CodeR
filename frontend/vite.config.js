import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:4000',
      '/problems': 'http://localhost:4000',
      '/submissions': 'http://localhost:4000',
      '/leaderboard': 'http://localhost:4000',
      '/stats': 'http://localhost:4000',
      '/health': 'http://localhost:4000'
    }
  }
});
