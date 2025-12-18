import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy para o backend em dev
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
