import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,   // เปิดให้เครื่อง PDA ในวง LAN เดียวกันเข้ามาทดสอบได้ก่อน deploy
    port: 5173,
  },
});
