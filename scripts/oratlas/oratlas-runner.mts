// Executed by validate-with-oratlas.mjs under ORAtlas's own tsx so that the
// real @oratlas/contracts and @oratlas/extractor code ingests the export.
// Usage: tsx oratlas-runner.mts <oratlas-dir> <export-dir>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const [oratlasDir, exportDir] = process.argv.slice(2);
if (!oratlasDir || !exportDir) throw new Error("usage: oratlas-runner.mts <oratlas-dir> <export-dir>");

const load = (pkg: string) => import(pathToFileURL(join(oratlasDir, "packages", pkg, "src/index.ts")).href);
const contracts = await load("contracts");
const extractor = await load("extractor");

const files: Record<string, string> = {};
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[relative(exportDir, path).split("\\").join("/")] = readFileSync(path, "utf8");
  }
};
walk(exportDir);

const manifestValidation = contracts.validateReviewManifest(JSON.parse(files["review-manifest.json"] ?? "null"));
if (!manifestValidation.ok) {
  console.log(JSON.stringify({ manifestOk: false, errors: manifestValidation.errors }));
  process.exit(0);
}
const report = contracts.inspectionReportSchema.parse({
  schemaVersion: "1.0.0",
  repo: { host: "github.com", owner: "example", name: "review", canonicalUrl: "https://github.com/example/review" },
  inspectedAt: "2026-07-20T00:00:00.000Z",
  status: "succeeded",
  tree: Object.entries(files).map(([path, content]) => ({ path, size: content.length })),
  files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { path, size: content.length, content, truncated: false }])),
  limits: { maxFileBytes: 10_000_000, maxTotalBytes: 100_000_000, maxFileCount: 1000, totalBytesFetched: 0, filesFetched: Object.keys(files).length },
});
const result = extractor.extractKnowledgeWithOutcomes(report, manifestValidation.manifest);
console.log(
  JSON.stringify({
    manifestOk: true,
    counts: {
      claims: result.knowledge.claims.length,
      citations: result.knowledge.citations.length,
      relations: result.knowledge.relations.length,
      trust: result.knowledge.trust.length,
    },
    warnings: result.knowledge.warnings,
    outcomes: result.artifactOutcomes,
    claimIds: result.knowledge.claims.map((claim: { id: string }) => claim.id),
  }),
);
