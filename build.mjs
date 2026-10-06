import * as esbuild from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const watch = process.argv.includes("--watch");
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const outdirIndex = process.argv.indexOf("--outdir");
const customOutdir = outdirIndex >= 0;
const requestedOutdir = customOutdir ? process.argv[outdirIndex + 1] : "dist";
if (!requestedOutdir || requestedOutdir.startsWith("--")) {
  throw new Error("--outdir requires a directory path.");
}
const outdir = path.resolve(repoRoot, requestedOutdir);
// Keep existing unpacked installations at the repository root working. A
// requested output directory is isolated and never writes the legacy bundles.
const bundleOutdirs = customOutdir ? [outdir] : [outdir, repoRoot];
const staticFiles = [
  "LICENSE",
  "manifest.json",
  "popup.html",
  "options.html",
  "content.css",
  "THIRD_PARTY_NOTICES.md",
];
const installationFiles = ["INSTALL.md", "PRIVACY.md"];

/** @type {esbuild.BuildOptions} */
const shared = {
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: false,
  sourcemap: false,
  logLevel: "info",
  absWorkingDir: repoRoot,
};

const entryPoints = {
  background: "src/service-worker/index.ts",
  content: "src/content/index.ts",
  popup: "src/popup/index.ts",
  options: "src/options/index.ts",
};

async function main() {
  await prepareDist();

  const contexts = await Promise.all(
    bundleOutdirs.map((bundleOutdir) =>
      esbuild.context({
        ...shared,
        entryPoints,
        outdir: bundleOutdir,
      }),
    ),
  );

  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

async function prepareDist() {
  if (customOutdir) {
    // An explicitly selected directory may contain user data. Never clear it.
    await mkdir(outdir, { recursive: true });
    if ((await readdir(outdir)).length > 0) {
      throw new Error(`Custom build directory must be empty: ${outdir}`);
    }
  } else {
    // This is the fixed generated dist directory, never a caller-built path.
    await rm(path.join(repoRoot, "dist"), { recursive: true, force: true });
  }
  await mkdir(outdir, { recursive: true });
  await Promise.all([
    ...staticFiles.map((file) => cp(path.join(repoRoot, file), path.join(outdir, file))),
    ...installationFiles.map((file) => cp(path.join(repoRoot, "docs", file), path.join(outdir, file))),
  ]);
  await cp(path.join(repoRoot, "icons"), path.join(outdir, "icons"), { recursive: true });
  await cp(path.join(repoRoot, "licenses"), path.join(outdir, "licenses"), { recursive: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
