#!/usr/bin/env node
// Keeps plugin.json, server.json, and manifest.json in lockstep with
// package.json. Runs automatically from the `npm version` lifecycle.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf-8")
);

const targets = [
  { file: ".claude-plugin/plugin.json", set: (j) => (j.version = version) },
  {
    file: "server.json",
    set: (j) => {
      j.version = version;
      for (const pkg of j.packages ?? []) pkg.version = version;
    },
  },
  { file: "manifest.json", set: (j) => (j.version = version) },
];

for (const { file, set } of targets) {
  const path = join(root, file);
  const json = JSON.parse(readFileSync(path, "utf-8"));
  set(json);
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  console.log(`synced ${file} → ${version}`);
}
