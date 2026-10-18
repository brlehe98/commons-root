// Builds a slim Root package: the server only ships its runtime
// dependencies, so the upload stays far below Root's 100 MiB limit.
// Usage: npm run package   (after setting the real app id in root-manifest.json)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const stage = path.join(root, ".package");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "root-manifest.json"), "utf8"));
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });
const installedVersion = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).version;

// A clean server build, so no leftover file from earlier builds ships.
fs.rmSync(path.join(root, "server/dist"), { recursive: true, force: true });
// The server is a composite project: without its build info, tsc rebuilds dist.
fs.rmSync(path.join(root, "server/tsconfig.tsbuildinfo"), { force: true });
run("npm run build");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage);
fs.cpSync(path.join(root, "client/dist"), path.join(stage, "client/dist"), { recursive: true });
fs.cpSync(path.join(root, "server/dist"), path.join(stage, "server/dist"), { recursive: true });

const runtimeDeps = ["@rootsdk/server-app", "@protobuf-ts/runtime", "yjs", "y-protocols", "lib0", "sqlite3"];
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "commons-root-package",
      private: true,
      dependencies: Object.fromEntries(runtimeDeps.map((d) => [d, installedVersion(d)])),
      // Same security overrides as the project (security/reports/DEPENDENCIES_REPORT.md).
      overrides: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).overrides,
    },
    null,
    2,
  ),
);
run("npm install --omit=dev --no-audit --no-fund", stage);

// The generated networking packages are local, so copy them in directly.
for (const pkg of ["server", "shared"]) {
  const dest = path.join(stage, "node_modules/@commons-root", `gen-${pkg}`);
  fs.cpSync(path.join(root, "networking/gen", pkg, "dist"), path.join(dest, "dist"), { recursive: true });
  fs.copyFileSync(path.join(root, "networking/gen", pkg, "package.json"), path.join(dest, "package.json"));
}

manifest.package.server.deploy = ["server/dist"];
manifest.package.server.nodeModules = ["node_modules"];
fs.writeFileSync(path.join(stage, "root-manifest.json"), JSON.stringify(manifest, null, 2));

const out = path.join(root, `commons-root-${manifest.version.replaceAll(".", "-")}.pkg`);
run(`npx rootsdk build package --project-folder ${stage} --output-file ${out}`);
console.log(`Package ready: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MiB)`);
