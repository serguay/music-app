import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

export default defineConfig({
  plugins: [
    vue(),

    VitePWA({
      registerType: "autoUpdate",

      // ✅ Solo deja lo que exista de verdad
      includeAssets: ["favicon.ico"],

      manifest: {
        name: "Music App",
        short_name: "Music",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",

        // ❌ Quitamos icons para que NO pida icon-192.png
        // icons: [...]
      },

      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: "./index.html",
      },

      devOptions: {
        enabled: true,
      },
    }),
  ],

  base: "./",

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  server: {
    host: true,
    allowedHosts: [".ngrok-free.dev"],
  },
});