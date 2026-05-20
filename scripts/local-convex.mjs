#!/usr/bin/env node
/* global console, process */

/**
 * Boots this repo's local Convex backend on a private port pair, using the
 * upstream test fixture credentials checked into `get-convex/convex-backend`
 * under `crates/keybroker/dev/`. These are public, well-known credentials
 * intended for local development, no admin-key derivation step, no Docker.
 *
 * Responsibilities:
 *  1. Lazy-install the pinned `convex-local-backend` binary on first run.
 *  2. Resolve repo-local ports (env: EVALBENCH_CONVEX_PORT /
 *     EVALBENCH_CONVEX_SITE_PORT, defaults 3312 / 3313). Different from
 *     convex-mcp-gateway's 3310/3311 and MasterEV's 3210/3211 so they can
 *     all run in parallel.
 *  3. Pre-flight port check.
 *  4. Write `.env.local` with `CONVEX_SELF_HOSTED_URL` /
 *     `CONVEX_SELF_HOSTED_ADMIN_KEY` so subsequent `convex` CLI commands
 *     pick them up automatically.
 *  5. Spawn the binary with `--instance-name carnitas` + matching secret.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureBinaryInstalled } from "./install-convex-binary.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// Upstream test fixtures from
// https://github.com/get-convex/convex-backend/tree/main/crates/keybroker/dev
// Public, deterministic, safe to commit. The admin key is the bare value
// (no `carnitas|` prefix) and the convex CLI accepts it both with and
// without the prefix.
const INSTANCE_NAME = "carnitas";
const INSTANCE_SECRET =
  "4361726e697461732c206c69746572616c6c79206d65616e696e6720226c6974";
const ADMIN_KEY =
  "0135d8598650f8f5cb0f30c34ec2e2bb62793bc28717c8eb6fb577996d50be5f4281b59181095065c5d0f86a2c31ddbe9b597ec62b47ded69782cd";

const PORT = parseInt(process.env.EVALBENCH_CONVEX_PORT || "3312", 10);
const SITE_PORT = parseInt(process.env.EVALBENCH_CONVEX_SITE_PORT || "3313", 10);

const DATA_DIR = resolve(REPO_ROOT, ".convex-local");
const DB_PATH = resolve(DATA_DIR, "db.sqlite3");
const STORAGE_DIR = resolve(DATA_DIR, "storage");
const ENV_FILE = resolve(REPO_ROOT, ".env.local");

function log(msg) {
  console.log(`\x1b[33m[convex-local]\x1b[0m ${msg}`);
}

function fail(msg) {
  console.error(`\x1b[31m[convex-local]\x1b[0m ${msg}`);
  process.exit(1);
}

function preflightPort(port) {
  return new Promise((resolveCheck) => {
    const tester = createServer()
      .once("error", () => resolveCheck(false))
      .once("listening", () => {
        tester.close(() => resolveCheck(true));
      })
      .listen(port, "127.0.0.1");
  });
}

async function checkPorts() {
  for (const port of [PORT, SITE_PORT]) {
    const free = await preflightPort(port);
    if (!free) {
      fail(
        `Port ${port} is in use. Either stop the other process or override ` +
          `with EVALBENCH_CONVEX_PORT / EVALBENCH_CONVEX_SITE_PORT.`,
      );
    }
  }
}

function writeEnvFile() {
  // Convex CLI accepts `CONVEX_SELF_HOSTED_ADMIN_KEY` with or without the
  // `<instance>|` prefix; the prefixed form is the canonical one the CLI
  // itself emits, so use that.
  const contents =
    `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:${PORT}\n` +
    `CONVEX_SELF_HOSTED_ADMIN_KEY=${INSTANCE_NAME}|${ADMIN_KEY}\n`;
  if (existsSync(ENV_FILE) && readFileSync(ENV_FILE, "utf-8") === contents) {
    return;
  }
  writeFileSync(ENV_FILE, contents);
  log(`Wrote ${ENV_FILE}`);
}

async function main() {
  const binary = await ensureBinaryInstalled();
  await checkPorts();

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(STORAGE_DIR, { recursive: true });

  writeEnvFile();

  const args = [
    "--instance-name",
    INSTANCE_NAME,
    "--instance-secret",
    INSTANCE_SECRET,
    "--interface",
    "127.0.0.1",
    "--port",
    String(PORT),
    "--site-proxy-port",
    String(SITE_PORT),
    "--convex-origin",
    `http://127.0.0.1:${PORT}`,
    "--convex-site",
    `http://127.0.0.1:${SITE_PORT}`,
    "--disable-beacon",
    "--local-storage",
    STORAGE_DIR,
    DB_PATH,
  ];

  log(`Starting on :${PORT} (site :${SITE_PORT})`);
  const child = spawn(binary, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  let gracefulShutdown = false;
  const forward = (sig) => {
    gracefulShutdown = true;
    if (child.pid && !child.killed) {
      child.kill(sig);
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (!gracefulShutdown) {
      log(`Backend exited (code=${code}, signal=${signal})`);
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

main().catch((err) => {
  console.error(`[convex-local] ${err.message}`);
  process.exit(1);
});
