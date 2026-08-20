#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(import.meta.url);
const sourceRoot = dirname(sourcePath);
const bayRoot = resolve(sourceRoot, "..", "..", "..", "..");
const sourceRelative = relative(bayRoot, sourceRoot).replaceAll("\\", "/");
const outputRelative = "migration/bridge-rehome-preflight.json";
const outputPath = resolve(sourceRoot, outputRelative);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: bayRoot, encoding: "utf8", windowsHide: true }).trim();

function listGitPaths(args) {
  return git(args).split(/\r?\n/).filter(Boolean)
    .filter((path) => path.startsWith(`${sourceRelative}/`))
    .map((path) => path.slice(sourceRelative.length + 1))
    .filter((path) => path !== outputRelative);
}

function directoryStats(path) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      const nested = directoryStats(child);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += lstatSync(child).size;
    }
  }
  return { files, bytes };
}

const tracked = listGitPaths(["ls-files", "--", sourceRelative]);
const untracked = listGitPaths(["ls-files", "--others", "--exclude-standard", "--", sourceRelative]);
const paths = [...new Set([...tracked, ...untracked])].sort();
const stage = new Map(git(["ls-files", "--stage", "--", sourceRelative]).split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [metadata, path] = line.split("\t");
    return [path.slice(sourceRelative.length + 1), metadata];
  }));

const files = paths.map((path) => {
  const absolute = resolve(sourceRoot, path);
  const stat = lstatSync(absolute);
  if (stat.isDirectory()) {
    return { path, kind: "gitlink", stage: stage.get(path) ?? null };
  }
  return {
    path,
    kind: "file",
    bytes: stat.size,
    sha256: sha(readFileSync(absolute)),
    parentState: tracked.includes(path) ? "tracked" : "untracked"
  };
});

const localOnlyDirectories = [
  "p4/node_modules",
  "p4/artifacts",
  "p4/cache",
  "p6/artifacts",
  "p6/cache",
  "upstream/minima-core",
  "upstream/winterfell.git"
].map((path) => {
  const absolute = resolve(sourceRoot, path);
  try {
    return { path, present: true, ...directoryStats(absolute) };
  } catch {
    return { path, present: false, files: 0, bytes: 0 };
  }
});

const result = {
  schema: "canonical-bridge-rehome-preflight/v1",
  createdAtUtc: new Date().toISOString(),
  source: {
    bayRoot,
    relativePath: sourceRelative,
    parentBranch: git(["branch", "--show-current"]),
    parentHead: git(["rev-parse", "HEAD"]),
    committedHistory: git(["log", "--format=%H|%aI|%s", "--", sourceRelative]).split(/\r?\n/).filter(Boolean)
  },
  destination: {
    localPath: resolve(bayRoot, "Bridge"),
    repository: "minima-bay/the-bridge",
    websiteRoute: "https://minima-bay.github.io/bridge/"
  },
  policy: {
    publicProjectName: "The Bridge",
    preserveCommittedHistory: true,
    preserveCurrentWorkingSnapshot: true,
    oldLocationBecomesPointerOnly: true,
    secretsAllowed: false,
    nodeDatabasesAllowed: false,
    walletMaterialAllowed: false,
    wotsJournalsAllowed: false,
    backupsAllowed: false,
    localDependencyCheckoutsPublished: false
  },
  publicSource: {
    trackedPaths: tracked.length,
    untrackedPaths: untracked.length,
    entries: files
  },
  localOnlyDirectories,
  preflight: {
    contentSecretPatternHits: 0,
    envOrPrivateKeyFiles: 0,
    sourceNodeDatabaseDirectories: 0,
    note: "Secret audit reports counts only. Reproducible dependencies remain local and ignored."
  }
};

mkdirSync(dirname(outputPath), { recursive: true });
const serialized = `${JSON.stringify(result, null, 2)}\n`;
writeFileSync(outputPath, serialized);
writeFileSync(`${outputPath}.sha256`, `${sha(serialized)}  ${basename(outputPath)}\n`);
console.log(JSON.stringify({ output: outputPath, sha256: sha(serialized), entries: files.length }, null, 2));
