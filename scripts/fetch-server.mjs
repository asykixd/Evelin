// Downloads the pinned scrcpy-server into resources/ and checks it against the pinned SHA-256:
// the binary is pushed to and executed on every connected phone.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { SCRCPY_VERSION, SCRCPY_SERVER_SHA256 } = JSON.parse(readFileSync(resolve(root, "src/shared/scrcpy-version.json"), "utf8"));
const target = resolve(root, "resources/scrcpy-server");
const versionFile = `${target}.version`;

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (existsSync(target) && existsSync(versionFile) && readFileSync(versionFile, "utf8") === SCRCPY_VERSION && sha256(target) === SCRCPY_SERVER_SHA256) {
  console.log(`scrcpy-server ${SCRCPY_VERSION} уже на месте`);
  process.exit(0);
}

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("@yume-chan/fetch-scrcpy-server/package.json"));
execFileSync(process.execPath, [resolve(pkgDir, "bin/fetch-server.js"), SCRCPY_VERSION], { stdio: "inherit" });
const downloaded = resolve(pkgDir, "server.bin");
const actual = sha256(downloaded);
if (actual !== SCRCPY_SERVER_SHA256) {
  rmSync(target, { force: true });
  console.error(`scrcpy-server ${SCRCPY_VERSION}: SHA-256 не совпадает (ожидался ${SCRCPY_SERVER_SHA256}, получен ${actual})`);
  process.exit(1);
}
writeFileSync(target, readFileSync(downloaded));
writeFileSync(versionFile, SCRCPY_VERSION);
console.log(`scrcpy-server ${SCRCPY_VERSION} -> resources/scrcpy-server (sha256 ok)`);
