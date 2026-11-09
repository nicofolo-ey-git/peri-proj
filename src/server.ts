import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ContractToolInputSchema,
  persistApprovedChange,
  runContractTool,
  SNAPSHOT_DATE,
  type Proposal,
} from "./tools/contratos.js";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT debe ser un puerto válido");

const pendingProposals = new Map<string, Proposal>();
const allowedApprovalOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
const ApprovalRequestSchema = z.object({ action: z.enum(["approve", "reject"]) }).strict();
const ToolRequestSchema = ContractToolInputSchema;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("El cuerpo de la solicitud supera 16 KiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, snapshot_date: SNAPSHOT_DATE, llm_enabled: false });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tools") {
    const parsed = ToolRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: "Solicitud de herramienta inválida", details: parsed.error.issues });
      return;
    }
    const output = await runContractTool(parsed.data);
    if (parsed.data.tool !== "proponer_cambio") {
      sendJson(response, 200, { invocation_id: randomUUID(), status: "completed", input: parsed.data, output });
      return;
    }

    const proposalId = randomUUID();
    const proposal: Proposal = {
      id: proposalId,
      contract_id: parsed.data.contract_id,
      field: parsed.data.field,
    };
    pendingProposals.set(proposalId, proposal);
    sendJson(response, 200, {
      invocation_id: randomUUID(),
      status: "awaiting_human_approval",
      input: parsed.data,
      output: { ...output, proposal_id: proposalId },
    });
    return;
  }

  const approvalMatch = request.method === "POST" && url.pathname.match(/^\/api\/approvals\/([0-9a-f-]+)$/i);
  if (approvalMatch) {
    const origin = request.headers.origin;
    if (origin && !allowedApprovalOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origen no autorizado para aprobar cambios" });
      return;
    }
    const parsed = ApprovalRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: "Decisión de aprobación inválida", details: parsed.error.issues });
      return;
    }
    const proposal = pendingProposals.get(approvalMatch[1]!);
    if (!proposal) {
      sendJson(response, 404, { error: "La propuesta no existe o ya fue resuelta" });
      return;
    }
    if (parsed.data.action === "reject") {
      pendingProposals.delete(approvalMatch[1]!);
      sendJson(response, 200, { status: "rejected", persisted: false });
      return;
    }
    pendingProposals.delete(approvalMatch[1]!);
    let event;
    try {
      event = await persistApprovedChange(proposal);
    } catch (error) {
      pendingProposals.set(approvalMatch[1]!, proposal);
      throw error;
    }
    sendJson(response, 200, { status: "approved_and_logged", persisted: true, event });
    return;
  }

  sendJson(response, 404, { error: "Ruta no encontrada" });
}

createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Error interno";
    if (!response.headersSent) sendJson(response, 500, { error: message });
    else response.destroy();
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`API local disponible en http://127.0.0.1:${port}`);
});
