// Скачивает scrcpy-server нужной версии и кладёт его в resources/.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { SCRCPY_VERSION } = JSON.parse(readFileSync(resolve(root, "src/shared/scrcpy-version.json"), "utf8"));
const target = resolve(root, "resources/scrcpy-server");
const versionFile = `${target}.version`;

if (existsSync(target) && existsSync(versionFile) && readFileSync(versionFile, "utf8") === SCRCPY_VERSION) {
  console.log(`scrcpy-server ${SCRCPY_VERSION} уже на месте`);
  process.exit(0);
}

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("@yume-chan/fetch-scrcpy-server/package.json"));
execFileSync(process.execPath, [resolve(pkgDir, "bin/fetch-server.js"), SCRCPY_VERSION], { stdio: "inherit" });
copyFileSync(resolve(pkgDir, "server.bin"), target);
const { writeFileSync } = await import("node:fs");
writeFileSync(versionFile, SCRCPY_VERSION);
console.log(`scrcpy-server ${SCRCPY_VERSION} -> resources/scrcpy-server`);
