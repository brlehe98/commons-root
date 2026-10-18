import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  server: {
    open: true,
  },
  build: {
    // No source maps in the package Root serves: they would expose the full source.
    sourcemap: false,
  },
  resolve: {
    // y-prosemirror and Tiptap must share one copy of these, or the editor
    // sees two different ProseMirror/Yjs instances.
    dedupe: ["yjs", "prosemirror-model", "prosemirror-state", "prosemirror-view", "prosemirror-transform"],
    alias: [
      // The dictionary-* packages only export their Node loader; the
      // editor fetches the raw .aff and .dic files ("@dictionary-de/index.dic").
      { find: /^@(dictionary-[a-z-]+)\//, replacement: fileURLToPath(new URL("../node_modules/", import.meta.url)) + "$1/" },
    ],
  },
  // Hunspell and Harper find their .wasm next to their own module: keep them
  // out of Vite's pre-bundling, which would move the module away from the file.
  optimizeDeps: { exclude: ["hunspell-wasm", "harper.js"] },
  worker: { format: "es" },
  // Type errors are caught by `tsc` in the build and by the editor.
  plugins: [react(), hotReload],
});

function hotReload() {
  return {
    name: "hotreload-hmr",
    enforce: "post",
    // HMR
    handleHotUpdate({ file, server }) {
      console.log(file);
      if (
        file.endsWith(".json") ||
        file.endsWith(".tsx") ||
        file.endsWith(".ts")
      ) {
        console.log("reloading...");

        server.ws.send({
          type: "full-reload",
          path: "*",
        });
      }
    },
  };
}
