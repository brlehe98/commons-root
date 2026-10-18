// Fails when a server RPC handler does not check who is calling.
// Root authenticates every call (client.userId comes from Root, not from the
// request), but each handler must still check the caller's level before
// reading or writing anything. Run: node scripts/check-rpc-access.mjs
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../server/src");
// Handlers that only touch the caller's own data, or decide visibility themselves.
const OWN_DATA = new Set([
  "WikiService.getMe", // the caller's own id, admin flag and report count
  "NotifyService.getPrefs", // the caller's own notification choices
  "NotifyService.setPrefs",
]);
const CHECKS = /\b(requireAdmin|requireLevel|requireDoc|docAccess|levelIn|isAppAdmin|pageAccess|canSeePage|visible|summaries|requireFollowable|editsSomewhere)\(/;
// Internal methods, not reachable from the client (absent from the .proto services).
const INTERNAL = new Set(["resyncAllGroups"]);

let failures = 0;
let checked = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith("Service.ts"))) {
  const source = fs.readFileSync(path.join(dir, file), "utf8");
  const cls = /export class (\w+) extends \w+Base \{/.exec(source);
  if (!cls) continue;
  const body = source.slice(cls.index);
  const methods = [...body.matchAll(/\n  async (\w+)\(/g)];
  methods.forEach((m, i) => {
    const name = m[1];
    if (name.startsWith("broadcast") || INTERNAL.has(name)) return;
    const end = i + 1 < methods.length ? methods[i + 1].index : body.length;
    const code = body.slice(m.index, end);
    const id = `${cls[1]}.${name}`;
    checked++;
    if (OWN_DATA.has(id)) return;
    if (!CHECKS.test(code)) {
      console.error(`No access check in ${id} (${file})`);
      failures++;
    }
  });
}
console.log(`${checked} RPC handlers checked, ${failures} without an access check.`);
process.exit(failures ? 1 : 0);
