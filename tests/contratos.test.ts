import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ContractToolInputSchema,
  findUpcomingExpirations,
  loadContractDataset,
  persistApprovedChange,
  parseCsv,
  runContractTool,
} from "../src/tools/contratos.js";

async function temporaryDataset(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contract-agent-test-"));
  const fixtureDirectory = path.resolve("fixtures", "reto-02");
  await Promise.all(["comerciales.json", "maestro-contratos.csv"].map((file) =>
    copyFile(path.join(fixtureDirectory, file), path.join(directory, file)),
  ));
  return directory;
}

test("CSV parser keeps commas and newlines inside quoted fields", () => {
  assert.deepEqual(parseCsv('id,notes\r\nCTR-1,"uno, dos\ncontinuación"\r\n'), [
    ["id", "notes"],
    ["CTR-1", "uno, dos\ncontinuación"],
  ]);
});

test("tool schema rejects writes and unknown fields", () => {
  assert.equal(ContractToolInputSchema.safeParse({ tool: "eliminar", contract_id: "CTR-001" }).success, false);
  assert.equal(ContractToolInputSchema.safeParse({
    tool: "proponer_cambio",
    contract_id: "CTR-001",
    field: { field: "owner", value: "Equipo Legal" },
  }).success, true);
});

test("snapshot reads synthetic sources and calculates expirations against fixed cutoff", async () => {
  const { contracts } = await loadContractDataset();
  assert.equal(contracts.length, 5);
  assert.deepEqual(findUpcomingExpirations(contracts).map(({ id }) => id), ["CTR-001", "CTR-002"]);
});

test("proposal alone does not persist; explicit approval writes an overlay and preserves snapshot", async () => {
  const directory = await temporaryDataset();
  const csvPath = path.join(directory, "maestro-contratos.csv");
  const originalCsv = await readFile(csvPath, "utf8");
  try {
    const result = await runContractTool({
      tool: "proponer_cambio",
      contract_id: "CTR-001",
      field: { field: "owner", value: "Equipo Legal" },
    }, directory);
    assert.equal(result.tool, "proponer_cambio");
    assert.equal(result.persisted, false);
    await assert.rejects(readFile(path.join(directory, "aprobados.jsonl")), { code: "ENOENT" });

    await persistApprovedChange({
      id: randomUUID(),
      contract_id: "CTR-001",
      field: { field: "owner", value: "Equipo Legal" },
    }, directory);
    const updated = await loadContractDataset(directory);
    assert.equal(updated.contracts.find(({ id }) => id === "CTR-001")?.owner, "Equipo Legal");
    assert.equal(await readFile(csvPath, "utf8"), originalCsv);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
