import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    plugins: [
      vue(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico"],
        manifest: {
          name: "Music App",
          short_name: "Music",
          start_url: "./",
          scope: "./",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#ffffff",
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallback: "./index.html",
        },
        devOptions: {
          enabled: !isDev ? true : false, // <- OFF en dev
          // o simplemente: enabled: false,
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
  };
});