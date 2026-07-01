import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";

function manualChunks(id) {
  const normalizedId = id.replaceAll("\\", "/");
  if (!normalizedId.includes("/node_modules/")) return undefined;

  if (
    normalizedId.includes("/jspdf/") ||
    normalizedId.includes("/html2canvas/")
  ) {
    return "chunk-pdf";
  }

  if (
    normalizedId.includes("/docx-preview/") ||
    normalizedId.includes("/docxtemplater/") ||
    normalizedId.includes("/pizzip/") ||
    normalizedId.includes("/jszip/")
  ) {
    return "chunk-docx";
  }

  if (
    normalizedId.includes("/react-apexcharts/") ||
    normalizedId.includes("/apexcharts/")
  ) {
    return "chunk-apexcharts";
  }

  if (
    normalizedId.includes("/echarts-for-react/") ||
    normalizedId.includes("/echarts/") ||
    normalizedId.includes("/zrender/")
  ) {
    return "chunk-echarts";
  }

  if (normalizedId.includes("/recharts/")) return "chunk-recharts";
  if (normalizedId.includes("/framer-motion/")) return "chunk-framer";

  if (
    normalizedId.includes("/@fullcalendar/") ||
    normalizedId.includes("/react-big-calendar/") ||
    normalizedId.includes("/react-calendar-timeline/")
  ) {
    return "chunk-calendar";
  }

  if (
    normalizedId.includes("/vis-data/") ||
    normalizedId.includes("/vis-timeline/") ||
    normalizedId.includes("/vis-util/")
  ) {
    return "chunk-vis";
  }

  if (
    normalizedId.includes("/@xyflow/") ||
    normalizedId.includes("/reactflow/")
  ) {
    return "chunk-flow";
  }

  if (
    normalizedId.includes("/@dnd-kit/") ||
    normalizedId.includes("/sortablejs/") ||
    normalizedId.includes("/interactjs/")
  ) {
    return "chunk-dnd";
  }

  if (
    normalizedId.includes("/date-fns/") ||
    normalizedId.includes("/moment/") ||
    normalizedId.includes("/moment-timezone/")
  ) {
    return "chunk-dates";
  }

  if (
    normalizedId.includes("/@radix-ui/") ||
    normalizedId.includes("/cmdk/") ||
    normalizedId.includes("/class-variance-authority/") ||
    normalizedId.includes("/clsx/") ||
    normalizedId.includes("/tailwind-merge/")
  ) {
    return "vendor-ui";
  }

  return undefined;
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["@rsagiev/gantt-task-react-19"],
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
