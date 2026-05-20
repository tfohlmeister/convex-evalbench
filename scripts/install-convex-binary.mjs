#!/usr/bin/env node
/* global console, process, fetch, Buffer */

/**
 * Lazy installer for the `convex-local-backend` binary used by this repo's
 * local dev / codegen cycle. Modelled after MasterEV's installer, but every
 * artifact lands inside *this* repo's `.tools/`, never reused from elsewhere.
 *
 * Filesystem layout:
 *   .tools/convex-local-backend/<version>/convex-local-backend
 *   .tools/convex-local-backend/current  -> <version>/
 *
 * Why lazy and not a `postinstall` hook?
 *   `postinstall` would download ~80 MB on every `pnpm install`, fail on
 *   unsupported arches, and run in CI/Docker where we don't need it. The
 *   start-script imports `ensureBinaryInstalled` just-in-time.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "..");
const TOOLS_DIR = join(REPO_ROOT, ".tools", "convex-local-backend");
const VERSION_FILE = join(__dirname, "convex-binary-version.json");

function readPinnedSpec() {
  const json = JSON.parse(readFileSync(VERSION_FILE, "utf-8"));
  if (typeof json.version !== "string" || !json.version) {
    throw new Error(
      `${VERSION_FILE} is missing a string "version" field`,
    );
  }
  if (!json.sha256 || typeof json.sha256 !== "object") {
    throw new Error(
      `${VERSION_FILE} is missing the "sha256" object (per-arch SHA-256 pins)`,
    );
  }
  return json;
}

function archKey() {
  if (process.platform === "darwin" && process.arch === "arm64")
    return "darwin-arm64";
  if (process.platform === "darwin" && process.arch === "x64")
    return "darwin-x64";
  if (process.platform === "linux" && process.arch === "x64")
    return "linux-x64";
  if (process.platform === "linux" && process.arch === "arm64")
    return "linux-arm64";
  return null;
}

function detectAsset() {
  switch (archKey()) {
    case "darwin-arm64":
      return "convex-local-backend-aarch64-apple-darwin.zip";
    case "darwin-x64":
      return "convex-local-backend-x86_64-apple-darwin.zip";
    case "linux-x64":
      return "convex-local-backend-x86_64-unknown-linux-gnu.zip";
    case "linux-arm64":
      return "convex-local-backend-aarch64-unknown-linux-gnu.zip";
    default:
      return null;
  }
}

function logInstall(msg) {
  console.log(`\x1b[33m[install-convex-binary]\x1b[0m ${msg}`);
}

function targetForVersion(version) {
  return join(TOOLS_DIR, version);
}

function binaryPathFor(version) {
  return join(targetForVersion(version), "convex-local-backend");
}

function currentSymlinkPath() {
  return join(TOOLS_DIR, "current");
}

function currentBinaryPath() {
  return join(currentSymlinkPath(), "convex-local-backend");
}

function readCurrentSymlinkTarget() {
  try {
    return readlinkSync(currentSymlinkPath());
  } catch {
    return null;
  }
}

function isExecutable(path) {
  if (!existsSync(path)) return false;
  try {
    const st = lstatSync(path);
    if (!st.isFile()) return false;
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function downloadAndExtract(version, assetName, expectedSha256) {
  const url = `https://github.com/get-convex/convex-backend/releases/download/precompiled-${version}/${assetName}`;
  logInstall(`Downloading ${assetName} (${version})...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Download failed: HTTP ${response.status} ${response.statusText} for ${url}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const actualSha = createHash("sha256").update(buffer).digest("hex");
  if (expectedSha256 === "TBD") {
    logInstall(
      `WARNING: SHA-256 pin is TBD for ${assetName}. Got ${actualSha}. ` +
        `Persist this into scripts/convex-binary-version.json once verified.`,
    );
  } else if (actualSha !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${assetName}:\n` +
        `  expected: ${expectedSha256}\n` +
        `  got:      ${actualSha}\n` +
        `Refusing to install. If the upstream release was legitimately re-cut, ` +
        `update scripts/convex-binary-version.json.`,
    );
  } else {
    logInstall(`SHA-256 verified (${actualSha.slice(0, 12)}...)`);
  }

  const destDir = targetForVersion(version);
  mkdirSync(destDir, { recursive: true });

  const zipPath = join(destDir, assetName);
  writeFileSync(zipPath, buffer);

  logInstall(`Extracting into ${destDir}...`);
  const unzip = spawnSync("unzip", ["-o", "-q", zipPath, "-d", destDir], {
    stdio: "inherit",
  });
  if (unzip.status !== 0) {
    throw new Error(
      `unzip exited with code ${unzip.status}. Is the \`unzip\` CLI installed?`,
    );
  }

  unlinkSync(zipPath);

  const binPath = binaryPathFor(version);
  if (!existsSync(binPath)) {
    throw new Error(
      `Expected ${binPath} after extracting ${assetName}, but it is missing`,
    );
  }

  chmodSync(binPath, 0o755);
}

function pointCurrentAt(version) {
  const link = currentSymlinkPath();
  if (lstatSync(link, { throwIfNoEntry: false })) {
    rmSync(link, { force: true });
  }
  symlinkSync(version, link, "dir");
}

export async function ensureBinaryInstalled() {
  const spec = readPinnedSpec();
  const version = spec.version;
  const versionedBinary = binaryPathFor(version);
  const currentBinary = currentBinaryPath();

  if (
    isExecutable(versionedBinary) &&
    existsSync(currentSymlinkPath()) &&
    isExecutable(currentBinary) &&
    readCurrentSymlinkTarget() === version
  ) {
    return currentBinary;
  }

  const arch = archKey();
  const asset = detectAsset();
  if (!arch || !asset) {
    process.stderr.write(
      `\n[install-convex-binary] Unsupported platform/arch: ${process.platform}/${process.arch}\n` +
        `Convex releases only ship: darwin-arm64, darwin-x64, linux-x64, linux-arm64.\n\n`,
    );
    process.exit(1);
  }

  const expectedSha = spec.sha256?.[arch];
  if (!expectedSha) {
    process.stderr.write(
      `\n[install-convex-binary] No pinned SHA-256 for arch "${arch}" in convex-binary-version.json.\n\n`,
    );
    process.exit(1);
  }

  if (!isExecutable(versionedBinary)) {
    mkdirSync(TOOLS_DIR, { recursive: true });
    await downloadAndExtract(version, asset, expectedSha);
  }

  pointCurrentAt(version);

  logInstall(`Convex ${version} ready at ${currentBinary}`);
  return currentBinary;
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  ensureBinaryInstalled().catch((err) => {
    console.error(`[install-convex-binary] ${err.message}`);
    process.exit(1);
  });
}
