const { buildSync } = require("esbuild");
const common = { bundle: true, minify: true, target: "es2020" };
buildSync({
  ...common,
  entryPoints: ["builds/cdn.js"],
  outfile: "dist/cdn.min.js",
  format: "iife",
});
buildSync({
  ...common,
  entryPoints: ["builds/module.js"],
  outfile: "dist/module.esm.js",
  format: "esm",
});
