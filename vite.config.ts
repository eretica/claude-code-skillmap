import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 開発時のみ: /api をローカルのAPIサーバー(vercel dev やモック)に流す
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
})
