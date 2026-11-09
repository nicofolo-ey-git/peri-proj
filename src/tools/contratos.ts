import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const SNAPSHOT_DATE = "2026-05-30";
export const EXPIRY_WINDOW_DAYS = 30;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Debe ser una fecha ISO válida");

export const CommercialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  region: z.string().min(1),
}).strict();

export const ContractSchema = z.object({
  id: z.string().min(1),
  commercial_id: z.string().min(1),
  provider: z.string().min(1),
  service: z.string().min(1),
  start_date: IsoDateSchema,
  end_date: IsoDateSchema,
  status: z.enum(["active", "pending", "expired"]),
  annual_value: z.number().nonnegative(),
  currency: z.string().length(3),
  owner: z.string().min(1),
  notes: z.string(),
}).strict();

export const ChangeFieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("status"), value: z.enum(["active", "pending", "expired"]) }).strict(),
  z.object({ field: z.literal("owner"), value: z.string().trim().min(1).max(100) }).strict(),
  z.object({ field: z.literal("end_date"), value: IsoDateSchema }).strict(),
]);

export const ApprovedChangeSchema = z.object({
  proposal_id: z.string().uuid(),
  contract_id: z.string().min(1),
  field: ChangeFieldSchema,
  approved_at: z.string().datetime(),
}).strict();

export const ContractToolInputSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("buscar"), query: z.string().trim().min(1).max(200) }).strict(),
  z.object({ tool: z.literal("obtener"), contract_id: z.string().trim().min(1).max(100) }).strict(),
  z.object({ tool: z.literal("vencimientos") }).strict(),
  z.object({
    tool: z.literal("proponer_cambio"),
    contract_id: z.string().trim().min(1).max(100),
    field: ChangeFieldSchema,
  }).strict(),
]);

export type Commercial = z.infer<typeof CommercialSchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type ChangeField = z.infer<typeof ChangeFieldSchema>;
export type ContractToolInput = z.infer<typeof ContractToolInputSchema>;
export type ApprovedChange = z.infer<typeof ApprovedChangeSchema>;

export interface ContractDataset {
  commercials: Commercial[];
  contracts: Contract[];
}

export interface Proposal {
  id: string;
  contract_id: string;
  field: ChangeField;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("CSV inválido: campo entre comillas sin cerrar");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function parseContractsCsv(text: string): Contract[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("El CSV de contratos está vacío");
  const expectedHeaders = [
    "id", "commercial_id", "provider", "service", "start_date", "end_date",
    "status", "annual_value", "currency", "owner", "notes",
  ];
  if (header.length !== expectedHeaders.length || expectedHeaders.some((value, index) => header[index] !== value)) {
    throw new Error(`Encabezados inesperados en maestro-contratos.csv; se esperaba: ${expectedHeaders.join(",")}`);
  }

  return rows.map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`Fila CSV ${index + 2}: cantidad de columnas incorrecta`);
    const record = Object.fromEntries(header.map((name, column) => [name, cells[column]]));
    const parsed = ContractSchema.safeParse({ ...record, annual_value: Number(record.annual_value) });
    if (!parsed.success) throw new Error(`Fila CSV ${index + 2} inválida: ${parsed.error.message}`);
    return parsed.data;
  });
}

async function loadApprovedChanges(dataDirectory: string): Promise<ApprovedChange[]> {
  let contents: string;
  try {
    contents = await readFile(path.join(dataDirectory, "aprobados.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return contents.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const parsed = ApprovedChangeSchema.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`Evento aprobado ${index + 1} inválido: ${parsed.error.message}`);
    return parsed.data;
  });
}

export async function loadContractDataset(
  dataDirectory = path.resolve(process.cwd(), "fixtures", "reto-02"),
): Promise<ContractDataset> {
  const [commercialsText, contractsText, changes] = await Promise.all([
    readFile(path.join(dataDirectory, "comerciales.json"), "utf8"),
    readFile(path.join(dataDirectory, "maestro-contratos.csv"), "utf8"),
    loadApprovedChanges(dataDirectory),
  ]);
  const rawCommercials: unknown = JSON.parse(commercialsText);
  const parsedCommercials = z.array(CommercialSchema).safeParse(rawCommercials);
  if (!parsedCommercials.success) throw new Error(`comerciales.json inválido: ${parsedCommercials.error.message}`);
  const contracts = parseContractsCsv(contractsText);
  const commercialIds = new Set(parsedCommercials.data.map(({ id }) => id));
  for (const contract of contracts) {
    if (!commercialIds.has(contract.commercial_id)) {
      throw new Error(`El contrato ${contract.id} referencia un comercial inexistente: ${contract.commercial_id}`);
    }
  }

  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  for (const change of changes) {
    const contract = contractById.get(change.contract_id);
    if (!contract) throw new Error(`Aprobación ${change.proposal_id} referencia un contrato inexistente`);
    switch (change.field.field) {
      case "status":
        contract.status = change.field.value;
        break;
      case "owner":
        contract.owner = change.field.value;
        break;
      case "end_date":
        contract.end_date = change.field.value;
        break;
    }
  }
  return { commercials: parsedCommercials.data, contracts };
}

export function searchContracts(contracts: Contract[], query: string): Contract[] {
  const normalizedQuery = query.toLocaleLowerCase("es");
  return contracts.filter((contract) =>
    [contract.id, contract.provider, contract.service, contract.owner, contract.status]
      .some((value) => value.toLocaleLowerCase("es").includes(normalizedQuery)),
  );
}

export function findContract(contracts: Contract[], contractId: string): Contract | undefined {
  return contracts.find(({ id }) => id.toLocaleLowerCase("es") === contractId.toLocaleLowerCase("es"));
}

export function findUpcomingExpirations(
  contracts: Contract[],
  asOf = SNAPSHOT_DATE,
  windowDays = EXPIRY_WINDOW_DAYS,
): Contract[] {
  const cutoff = new Date(`${asOf}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + windowDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return contracts.filter(({ end_date, status }) => status !== "expired" && end_date >= asOf && end_date <= cutoffDate)
    .sort((left, right) => left.end_date.localeCompare(right.end_date));
}

export async function runContractTool(input: ContractToolInput, dataDirectory?: string) {
  const validatedInput = ContractToolInputSchema.parse(input);
  const { contracts } = await loadContractDataset(dataDirectory);
  switch (validatedInput.tool) {
    case "buscar":
      return { tool: validatedInput.tool, query: validatedInput.query, results: searchContracts(contracts, validatedInput.query) };
    case "obtener": {
      const contract = findContract(contracts, validatedInput.contract_id);
      return { tool: validatedInput.tool, result: contract ?? null };
    }
    case "vencimientos":
      return { tool: validatedInput.tool, as_of: SNAPSHOT_DATE, window_days: EXPIRY_WINDOW_DAYS, results: findUpcomingExpirations(contracts) };
    case "proponer_cambio": {
      const contract = findContract(contracts, validatedInput.contract_id);
      if (!contract) throw new Error(`No existe el contrato ${validatedInput.contract_id}`);
      return {
        tool: validatedInput.tool,
        proposal: { contract_id: contract.id, current_value: contract[validatedInput.field.field], requested_change: validatedInput.field },
        requires_human_approval: true as const,
        persisted: false as const,
      };
    }
  }
}

export async function persistApprovedChange(
  proposal: Proposal,
  dataDirectory = path.resolve(process.cwd(), "fixtures", "reto-02"),
): Promise<ApprovedChange> {
  const validatedProposal = z.object({
    id: z.string().uuid(),
    contract_id: z.string().min(1),
    field: ChangeFieldSchema,
  }).strict().parse(proposal);
  const { contracts } = await loadContractDataset(dataDirectory);
  if (!findContract(contracts, validatedProposal.contract_id)) {
    throw new Error(`No existe el contrato ${validatedProposal.contract_id}`);
  }

  const event = ApprovedChangeSchema.parse({
    proposal_id: validatedProposal.id,
    contract_id: validatedProposal.contract_id,
    field: validatedProposal.field,
    approved_at: new Date().toISOString(),
  });
  await appendFile(path.join(dataDirectory, "aprobados.jsonl"), `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  return event;
}
