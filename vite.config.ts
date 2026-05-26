import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // NOTE: 思源插件加载使用 require()，必须输出 CommonJS；ESM 会导致默认导出丢失。
    lib: {
      entry: "src/index.ts",
      formats: ["cjs"],
      fileName: () => "index.js",
    },
    minify: false,
    rollupOptions: {
      external: ["siyuan", "node:fs/promises", "node:path", "node:os", "node:child_process"],
      output: {
        // NOTE: 思源期望从 module.exports.default 取插件类。
        exports: "named",
      },
    },
  },
});
