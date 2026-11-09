import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  findContract,
  findUpcomingExpirations,
  loadContractDataset,
  runContractTool,
  searchContracts,
} from "./src/tools/contratos.js";

const InboxMessageSchema = z.object({
  id: z.string().regex(/^msg-\d{3}$/),
  subject: z.string().min(1),
  body: z.string().min(1),
}).strict();
type InboxMessage = z.infer<typeof InboxMessageSchema>;

type Confidence = "alta" | "media" | "baja";

interface Classification {
  intent: string;
  intent_confidence: Confidence;
  extracted: Array<{ field: string; value: string; confidence: Confidence }>;
}

function classify(message: InboxMessage): Classification {
  const text = message.body;
  const searchableText = `${message.subject} ${message.body}`;
  const id = searchableText.match(/\bCTR-\d{3}\b/i)?.[0]?.toUpperCase();
  if (/(?:buscar|busca|localiza|encuentra)/i.test(text) && id) {
    return {
      intent: "obtener",
      intent_confidence: "alta",
      extracted: [{ field: "contract_id", value: id, confidence: "alta" }],
    };
  }
  const change = text.match(/(?:cambiar|actualizar)\s+(?:el\s+)?(?:responsable|owner)\s+(?:a|por)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+)/i);
  if (/cambiar|actualizar/i.test(text) && id && change) {
    return {
      intent: "proponer_cambio",
      intent_confidence: "alta",
      extracted: [
        { field: "contract_id", value: id, confidence: "alta" },
        { field: "owner", value: change[1]!.trim().replace(/[.!?].*$/, ""), confidence: "media" },
      ],
    };
  }
  if (/venc|expir/i.test(text)) {
    return { intent: "vencimientos", intent_confidence: "alta", extracted: [] };
  }
  if (/buscar|busca|localiza|encuentra/i.test(text)) {
    return {
      intent: "buscar",
      intent_confidence: "media",
      extracted: [{
        field: "query",
        value: text.replace(/buscar|busca|localiza|encuentra/ig, "").replace(/\s+en el maestro[.!?]*$/i, "").trim(),
        confidence: "media",
      }],
    };
  }
  return { intent: "requiere_aclaracion", intent_confidence: "baja", extracted: [] };
}

async function execute(message: InboxMessage): Promise<unknown> {
  const classification = classify(message);
  const { contracts } = await loadContractDataset();
  switch (classification.intent) {
    case "obtener": {
      const id = classification.extracted[0]?.value;
      return { tool: "obtener", result: id ? findContract(contracts, id) ?? null : null };
    }
    case "vencimientos":
      return { tool: "vencimientos", as_of: "2026-05-30", results: findUpcomingExpirations(contracts) };
    case "buscar": {
      const query = classification.extracted[0]?.value ?? "";
      return { tool: "buscar", results: searchContracts(contracts, query) };
    }
    case "proponer_cambio":
      return runContractTool({
        tool: "proponer_cambio",
        contract_id: classification.extracted.find(({ field }) => field === "contract_id")!.value,
        field: {
          field: "owner",
          value: classification.extracted.find(({ field }) => field === "owner")!.value,
        },
      });
    default:
      return { tool: null, action: "Sin llamada: pedir aclaración a una persona" };
  }
}

async function main(): Promise<void> {
  const inboxDirectory = path.resolve("fixtures", "reto-02", "buzon");
  const filenames = (await readdir(inboxDirectory)).filter((name) => /^msg-\d{3}\.json$/.test(name)).sort();
  const expectedFiles = Array.from({ length: 6 }, (_, index) => `msg-${String(index + 1).padStart(3, "0")}.json`);
  if (JSON.stringify(filenames) !== JSON.stringify(expectedFiles)) {
    throw new Error(`El buzón de demo debe contener exactamente: ${expectedFiles.join(", ")}`);
  }
  const messages = await Promise.all(filenames.map(async (filename) =>
    InboxMessageSchema.parse(JSON.parse(await readFile(path.join(inboxDirectory, filename), "utf8"))) as InboxMessage,
  ));
  for (const message of messages) {
    console.log(`\n${message.id} — ${message.subject}`);
    const classification = classify(message);
    console.log(`Clasificación: ${JSON.stringify(classification)}`);
    console.log(`Ejecución: ${JSON.stringify(await execute(message))}`);
  }
}

await main();
