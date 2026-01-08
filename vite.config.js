import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import pkg from './package.json'

export default defineConfig({
  plugins: [vue()],

  /* 🔥 CLAVE PARA ELECTRON (PANTALLA BLANCA FIX) */
  base: './',

  /* ✅ VERSION AUTOMÁTICA */
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  /* ✅ SERVER (NGROK OK, SOLO DEV) */
  server: {
    host: true,
    allowedHosts: [
      '.ngrok-free.dev',
    ],
  },
})
