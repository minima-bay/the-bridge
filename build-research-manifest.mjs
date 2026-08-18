import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "research-manifest.json");
const include = [
  "README.md",
  "feasibility-findings-2026-08-18.md",
  "minima-core-zk-verifier-rfc-2026-08-18.md",
  "bridge-public-inputs-v1.md",
  "reserve-covenant-transition-spec-v1.md",
  "proof-system-selection-matrix.md",
  "adversarial-verification-plan.md",
  "open-decisions.md",
  "fixtures/bridge-public-inputs-v1.json",
  "validate-rfc-fixtures.mjs",
  "minima-runtime-probe.mjs",
  "minima-kernel-probe.mjs",
  "winterfell-sha3-instrumentation-notes.md"
];

const evidenceFiles = fs.readdirSync(path.join(root, "evidence"))
  .filter((name) => !name.endsWith(".sha256"))
  .map((name) => `evidence/${name}`)
  .sort();

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
}

const files = [...include, ...evidenceFiles].map((file) => {
  const stat = fs.statSync(path.join(root, file));
  return { file, bytes: stat.size, sha256: digest(file) };
});

const fixtureDigest = `0x${digest("fixtures/bridge-public-inputs-v1.json")}`;
const validatorDigest = `0x${digest("validate-rfc-fixtures.mjs")}`;
const matchingEvidence = evidenceFiles
  .filter((file) => /^evidence\/rfc-fixture-validation-.*\.json$/.test(file))
  .map((file) => {
    try {
      return { file, data: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) };
    } catch {
      return null;
    }
  })
  .filter((item) => item && item.data.passed === true && item.data.fixtureSha256 === fixtureDigest && item.data.validatorSha256 === validatorDigest)
  .sort((a, b) => String(a.data.createdAt).localeCompare(String(b.data.createdAt)));

const currentFixtureEvidence = matchingEvidence.length > 0 ? matchingEvidence.at(-1).file : null;

const manifest = {
  manifestVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "no-funds ZK light-client and native Minima verifier research",
  exclusions: [
    "upstream bare repository internals",
    "generated .sha256 sidecars",
    "this manifest itself"
  ],
  currentFixtureEvidence,
  currentFixtureSha256: fixtureDigest,
  currentValidatorSha256: validatorDigest,
  files
};

fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, files: files.length }, null, 2));
