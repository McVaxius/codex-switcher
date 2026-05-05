import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const projectRoot = process.cwd().replace(/\\/g, "/");
const tailwindcssPackage = "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(async () => {
  const { default: tailwindcss } = await import(tailwindcssPackage);

  return {
    root: projectRoot,
    base: "./",
    plugins: [react(), tailwindcss()],

    // Vite options tailored for Electron development.
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // Legacy Rust sources are not part of the Electron runtime.
        ignored: ["**/src-tauri/**"],
      },
    },
    build: {
      rollupOptions: {
        input: `${projectRoot}/index.html`,
      },
    },
  };
});
