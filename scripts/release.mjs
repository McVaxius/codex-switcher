import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const input = process.argv[2];
const shouldPush = process.argv.includes("--push");

if (!input) {
  console.error("Usage: node scripts/release.mjs <version|major|minor|patch> [--push]");
  process.exit(1);
}

const VERSION_FILES = ["package.json"];

const readFile = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const run = (command, args, options = {}) => {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
};

const capture = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
  }).trim();

const parsePackageVersion = (contents) =>
  contents.match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/)?.[1] ?? null;

const getVersionSnapshot = () => {
  const packageVersion = parsePackageVersion(readFile("package.json"));

  return {
    "package.json": packageVersion,
  };
};

const assertCleanTree = () => {
  const status = capture("git", ["status", "--short"]);
  if (status) {
    console.error("Git working tree must be clean before running release.");
    console.error(status);
    process.exit(1);
  }
};

const assertVersionsMatch = (expectedVersion) => {
  const snapshot = getVersionSnapshot();
  const mismatches = Object.entries(snapshot).filter(([, version]) => version !== expectedVersion);

  if (mismatches.length > 0) {
    console.error(`Version verification failed for ${expectedVersion}:`);
    for (const [file, version] of mismatches) {
      console.error(`- ${file}: ${version ?? "missing"}`);
    }
    process.exit(1);
  }

  console.log(`Release version: ${expectedVersion}`);
  for (const file of VERSION_FILES) {
    console.log(`- ${file}: ${snapshot[file]}`);
  }
};

const currentVersion = parsePackageVersion(readFile("package.json"));
if (!currentVersion) {
  console.error("Could not determine current version from package.json");
  process.exit(1);
}

assertCleanTree();
run("node", ["scripts/bump-version.mjs", input]);

const nextVersion = parsePackageVersion(readFile("package.json"));
if (!nextVersion) {
  console.error("Could not determine next version from package.json");
  process.exit(1);
}

assertVersionsMatch(nextVersion);

run("git", ["add", ...VERSION_FILES]);
run("git", ["commit", "-m", `chore: release ${nextVersion}`]);
run("git", ["tag", "-a", `v${nextVersion}`, "-m", `v${nextVersion}`]);

console.log(`Created commit and tag for v${nextVersion}.`);

if (shouldPush) {
  const branch = capture("git", ["branch", "--show-current"]);
  run("git", ["push", "origin", branch]);
  run("git", ["push", "origin", `v${nextVersion}`]);
  console.log(`Pushed ${branch} and v${nextVersion}.`);
} else {
  const branch = capture("git", ["branch", "--show-current"]);
  console.log("Push skipped. Run these when ready:");
  console.log(`git push origin ${branch}`);
  console.log(`git push origin v${nextVersion}`);
}
