import * as esbuild from "esbuild";
import { readdir, rm, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const outdir = ".test-build";
const testFiles = (await readdir("tests", { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => `tests/${entry.name}`)
  .sort();

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: testFiles,
  outdir,
  entryNames: "[name]",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: false,
  logLevel: "silent",
});

const outputFiles = testFiles.map((file) =>
  `${outdir}/${file.slice("tests/".length, -".ts".length)}.mjs`,
);
const child = spawn(process.execPath, ["--test", ...outputFiles], {
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
