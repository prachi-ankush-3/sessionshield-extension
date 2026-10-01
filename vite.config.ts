import { defineConfig } from "vite";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        background: p("./src/background/background.ts"),
        popup: p("./src/popup/popup.html"),
        options: p("./src/options/options.html"),
      },
      output: {
        // manifest.json references "background.js" directly
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
  plugins: [
    {
      name: "copy-manifest",
      closeBundle() {
        copyFileSync(`${root}manifest.json`, `${root}dist/manifest.json`);
      },
    },
  ],
});
