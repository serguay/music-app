import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

export default defineConfig({
  plugins: [
    vue(),

    // ✅ PWA: cachea la UI (app shell) para abrir sin conexión
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icon-192.png", "icon-512.png"],

      manifest: {
        name: "Music App",
        short_name: "Music",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },

     workbox: {
  globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],

  // 👇 Subimos el límite para que Workbox no pete con assets grandes (2MB+)
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB

  // Para SPA: si recargas en /ruta, vuelve a index.html
  navigateFallback: "./index.html",
},

      devOptions: {
        enabled: true, // útil para probar en dev si quieres
      },
    }),
  ],

  /* 🔥 CLAVE PARA ELECTRON (PANTALLA BLANCA FIX) */
  base: "./",

  /* ✅ VERSION AUTOMÁTICA */
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  /* ✅ SERVER (NGROK OK, SOLO DEV) */
  server: {
    host: true,
    allowedHosts: [".ngrok-free.dev"],
  },
});
