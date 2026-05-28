import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react": path.resolve(__dirname, "../../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
      "react-dom/client": path.resolve(__dirname, "../../node_modules/react-dom/client"),
      "react-dom/server": path.resolve(__dirname, "../../node_modules/react-dom/server"),
      "react-dom/server.browser": path.resolve(__dirname, "../../node_modules/react-dom/server.browser"),
      "react-dom/server.bun": path.resolve(__dirname, "../../node_modules/react-dom/server.bun"),
      "react-dom/server.node": path.resolve(__dirname, "../../node_modules/react-dom/server.node"),
      "react/jsx-runtime": path.resolve(__dirname, "../../node_modules/react/jsx-runtime"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "../../node_modules/react/jsx-dev-runtime"),
    },
    dedupe: ["react", "react-dom", "scheduler"],
  },

  build: {
    sourcemap: true,
  },

  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
