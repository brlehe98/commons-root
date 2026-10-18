// Sends the newest package to Root: `npm run upload`.
// The token comes from server/.env (UPLOAD_TOKEN, else DEV_TOKEN) and is
// never printed. Arguments go to the CLI as a list, so no shell quoting can
// split or mangle them.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packages = fs
  .readdirSync(root)
  .filter((f) => /^commons-root-.*\.pkg$/.test(f))
  .map((f) => ({ f, time: fs.statSync(path.join(root, f)).mtimeMs }))
  .sort((a, b) => b.time - a.time);
if (!packages.length) {
  console.error("No package found. Build one first with: npm run package");
  process.exit(1);
}
const file = packages[0].f;

const env = fs.existsSync(path.join(root, "server/.env")) ? fs.readFileSync(path.join(root, "server/.env"), "utf8") : "";
const read = (name) => env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "");
const tokenName = read("UPLOAD_TOKEN") ? "UPLOAD_TOKEN" : "DEV_TOKEN";
const token = read(tokenName);
if (!token) {
  console.error("No token in server/.env: add a line UPLOAD_TOKEN=... (or DEV_TOKEN=...).");
  process.exit(1);
}

console.log(`Uploading ${file} with ${tokenName} from server/.env…`);
const cli = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "rootsdk.cmd" : "rootsdk");
const result = spawnSync(cli, ["upload", "package", "--file", file, "--authToken", token], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
