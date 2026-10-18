// Applies the patches in patches/ to node_modules after install, in place of
// patch-package (whose dependencies carry an unfixed advisory). Each patch is
// applied once: a patch already in place is detected and skipped.
// Runs as the root package's postinstall; needs git.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "patches");
const git = (args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
const applies = (args) => {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
};

let failed = 0;
for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".patch")) : []) {
  const patch = path.join("patches", file);
  // --ignore-whitespace: patches are stored with Windows line endings.
  if (applies(["apply", "--reverse", "--check", "--ignore-whitespace", patch])) {
    console.log(`patch ${file}: already applied`);
  } else if (applies(["apply", "--ignore-whitespace", patch])) {
    console.log(`patch ${file}: applied`);
  } else {
    console.error(`patch ${file}: does not apply (did the package version change?)`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
