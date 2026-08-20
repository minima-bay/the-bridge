#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const planPath = resolve(root, "CANONICAL-BRIDGE-GENERAL-IMPLEMENTATION-PLAN.md");
const controlPath = resolve(root, "USDTM-ZK-PROTOTYPE.md");
const plan = readFileSync(planPath, "utf8");
const control = readFileSync(controlPath, "utf8");
const failures = [];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fileSha = (relative) => sha(readFileSync(resolve(root, relative)));
const requireCondition = (condition, message) => { if (!condition) failures.push(message); };

const requiredSections = [
  "## 1. Authority and how to use this plan",
  "## 2. Preamble: problem, goal and boundaries",
  "## 3. System map",
  "## 4. Binding decisions",
  "## 5. Open founder decisions",
  "## 6. Findings: what the analysis established",
  "## 7. Phase dependency map and status",
  "## 8. Complete implementation plan",
  "## 9. Immediate work programme",
  "## 10. Public About page implementation track",
  "## 11. Evidence and documentation protocol",
  "## 12. Reference library by purpose",
  "## 13. Definition of a complete bridge"
];
for (const section of requiredSections) {
  requireCondition(plan.includes(section), `missing required section: ${section}`);
}

for (let index = 1; index <= 28; ++index) {
  const id = `D-USDTM-${String(index).padStart(3, "0")}`;
  requireCondition(plan.includes(`\`${id}\``), `missing binding decision reference: ${id}`);
}
for (const index of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15]) {
  const id = `O-USDTM-${String(index).padStart(3, "0")}`;
  requireCondition(plan.includes(`\`${id}\``), `missing open decision reference: ${id}`);
}
for (let phase = 0; phase <= 13; ++phase) {
  requireCondition(plan.includes(`### P${phase}.`), `missing implementation phase P${phase}`);
  requireCondition(plan.includes(`| P${phase} |`), `missing phase-board summary P${phase}`);
}
for (const range of ["F001-F008", "F009-F017", "F018", "F019-F038", "F039-F040",
  "F041-F043", "F044-F066", "F067-F070", "F071-F074", "F075-F084", "F085"]) {
  requireCondition(plan.includes(`\`${range}\``), `missing complete finding-family coverage: ${range}`);
}

const requiredReferences = [
  "USDTM-ZK-PROTOTYPE.md",
  "canonical-bridge-attestor-framework-discussion-v1.md",
  "P6-ETHEREUM-COMMITTEE-BOND-AND-REWARD-SPEC.md",
  "P9-COMPLETION-SPEC.md",
  "P9-WOTS-GUARD.md",
  "P9-DEPLOYMENT-ARCHITECTURE.md",
  "p9-deployment-profile.json",
  "MIGRATION.md",
  "evidence/README.md",
  "p4/contracts/USDTmVaultV1.sol",
  "p4/contracts/NativeAssetVaultV1.sol",
  "p6/contracts/AttestorRosterRegistryV1.sol",
  "p6/contracts/AttestorBondVaultV1.sol",
  "p6/contracts/AttestorExposureControllerV1.sol",
  "p6/contracts/AttestorFeeRewardTreasuryV1.sol",
  "p6/contracts/AttestorEpochRewardIndexV1.sol",
  "p6/contracts/AttestorWorkEpochV1.sol",
  "p6/contracts/ObjectiveDecisionVerifierV1.sol",
  "p6/contracts/AttestorWorkRewardIndexV1.sol",
  "wots-write-ahead-guard.mjs",
  "generic-bridge-transaction-lifecycle.mjs",
  "generic-bridge-p9-signing-authority.mjs",
  "generic-bridge-p9-chain-reconciler.mjs",
  "generic-bridge-p9-deployment-admission.mjs",
  "validate-generic-p9-deployment-admission.mjs"
];
for (const reference of requiredReferences) {
  requireCondition(plan.includes(reference), `missing required technical reference: ${reference}`);
  requireCondition(existsSync(resolve(root, reference)), `referenced local file does not exist: ${reference}`);
}

const localMarkdownLinks = [...plan.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
  .map((match) => match[1])
  .filter((target) => !/^[a-z]+:/i.test(target) && !target.startsWith("#"));
for (const target of localMarkdownLinks) {
  const pathOnly = decodeURIComponent(target.split("#")[0]);
  requireCondition(existsSync(resolve(root, pathOnly)), `broken local Markdown link: ${target}`);
}

const controlNow = control.match(/^\| NOW \| `([^`]+)` /m)?.[1];
requireCondition(controlNow === "P9", `unexpected authoritative NOW phase: ${controlNow ?? "missing"}`);
requireCondition(plan.includes("Current gate: `P9`"), "plan does not identify P9 as the current gate");
requireCondition(plan.includes("Production status: prohibited"), "production prohibition is missing");
requireCondition(plan.includes("indexed rewards are not claimable rewards"), "indexed-not-claimable boundary is missing");
requireCondition(plan.includes("a valid attestor quorum can lie about Ethereum"), "threshold trust boundary is missing");
requireCondition(plan.includes("never reactivate or sign with the retired P8 key domain"), "retired-key boundary is missing");
requireCondition(!plan.includes("\u2014"), "plan contains a forbidden em dash");

if (failures.length !== 0) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exit(1);
}

const result = {
  schema: "canonical-bridge-general-implementation-plan-validation/v1",
  createdAtUtc: new Date().toISOString(),
  status: "passed",
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  planSha256: sha(plan),
  controlDocumentSha256: sha(control),
  attestorFrameworkSha256: fileSha("canonical-bridge-attestor-framework-discussion-v1.md"),
  p6SpecificationSha256: fileSha("P6-ETHEREUM-COMMITTEE-BOND-AND-REWARD-SPEC.md"),
  p9CompletionSpecificationSha256: fileSha("P9-COMPLETION-SPEC.md"),
  p9GuardStatusSha256: fileSha("P9-WOTS-GUARD.md"),
  evidenceRulesSha256: fileSha("evidence/README.md"),
  authoritativeNow: controlNow,
  bindingDecisionReferencesChecked: 28,
  openDecisionReferencesChecked: 13,
  findingFamiliesChecked: 11,
  implementationPhasesChecked: 14,
  requiredTechnicalReferencesChecked: requiredReferences.length,
  localMarkdownLinksChecked: localMarkdownLinks.length,
  noEmDash: true,
  productionStatus: "prohibited",
  limitations: [
    "This validator checks plan structure, traceability, local-link existence and critical status boundaries; it does not validate bridge security or pass any phase gate.",
    "The control document, exact specifications, current source-bound validators and executed evidence remain authoritative over this navigation plan."
  ]
};

if (process.argv.includes("--evidence")) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-general-plan-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
