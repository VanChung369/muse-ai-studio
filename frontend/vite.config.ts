import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "MUSE_");
  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "^/api/": {
          target: env.MUSE_API_TARGET || "http://127.0.0.1:18610",
          changeOrigin: true,
        },
        // The public API. `xfwd` tells the backend which address the caller
        // used, so the result URLs it returns work from other machines too.
        "^/v1/": {
          target: env.MUSE_API_TARGET || "http://127.0.0.1:18610",
          changeOrigin: true,
          xfwd: true,
        },
      },
    },
  };
});
