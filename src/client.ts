import "./style.css";

interface ToolInvocation {
  invocation_id: string;
  status: "completed" | "awaiting_human_approval";
  input: unknown;
  output: Record<string, unknown>;
}

const messages = document.querySelector<HTMLOListElement>("#messages")!;
const toolLog = document.querySelector<HTMLDivElement>("#tool-log")!;
const form = document.querySelector<HTMLFormElement>("#chat-form")!;
const input = document.querySelector<HTMLTextAreaElement>("#chat-input")!;
const sendButton = document.querySelector<HTMLButtonElement>("#send-button")!;
const expiryCount = document.querySelector<HTMLSpanElement>("#expiry-count")!;

function addMessage(role: "user" | "assistant", text: string): void {
  const item = document.createElement("li");
  item.className = `message ${role}`;
  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "C";
    item.append(avatar);
  }
  const content = document.createElement("div");
  content.className = "message-content";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  content.append(paragraph);
  item.append(content);
  messages.append(item);
  item.scrollIntoView({ behavior: "smooth", block: "end" });
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function addToolCard(invocation: ToolInvocation): void {
  const card = document.createElement("section");
  card.className = "tool-entry";
  const heading = document.createElement("div");
  heading.className = "tool-entry-heading";
  const title = document.createElement("strong");
  title.textContent = String((invocation.input as { tool?: string }).tool ?? "herramienta");
  const status = document.createElement("span");
  status.className = `tool-status ${invocation.status === "completed" ? "done" : "pending"}`;
  status.textContent = invocation.status === "completed" ? "Completada" : "Aprobación pendiente";
  heading.append(title, status);
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Ver entrada y resultado";
  const pre = document.createElement("pre");
  pre.textContent = pretty({ input: invocation.input, output: invocation.output });
  details.append(summary, pre);
  card.append(heading, details);

  if (invocation.status === "awaiting_human_approval") {
    const buttons = document.createElement("div");
    buttons.className = "approval-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "approve-button";
    approve.textContent = "Aprobar escritura";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "reject-button";
    reject.textContent = "Rechazar";
    approve.addEventListener("click", () => resolveProposal(String(invocation.output.proposal_id), "approve", card));
    reject.addEventListener("click", () => resolveProposal(String(invocation.output.proposal_id), "reject", card));
    buttons.append(approve, reject);
    card.append(buttons);
  }
  toolLog.querySelector(".empty-state")?.remove();
  toolLog.prepend(card);
}

async function resolveProposal(proposalId: string, action: "approve" | "reject", card: HTMLElement): Promise<void> {
  const buttons = card.querySelectorAll<HTMLButtonElement>("button");
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch(`/api/approvals/${encodeURIComponent(proposalId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = await response.json() as { status?: string; error?: string; persisted?: boolean };
    if (!response.ok) throw new Error(result.error ?? `Error HTTP ${response.status}`);
    const status = card.querySelector<HTMLElement>(".tool-status");
    if (status) {
      status.className = `tool-status ${action === "approve" ? "done" : "rejected"}`;
      status.textContent = action === "approve" ? "Aprobada y registrada" : "Rechazada";
    }
    card.querySelector(".approval-actions")?.remove();
    addMessage("assistant", action === "approve"
      ? "Aprobación explícita registrada en el log operativo. El CSV histórico permanece intacto."
      : "Propuesta rechazada. No se realizó ninguna escritura.");
    if (action === "approve") await refreshExpiryCount();
  } catch (error) {
    buttons.forEach((button) => { button.disabled = false; });
    addMessage("assistant", `No se pudo resolver la propuesta: ${error instanceof Error ? error.message : "error desconocido"}`);
  }
}

function parseCommand(message: string): Record<string, unknown> {
  const parts = message.trim().split(/\s+/);
  const command = parts[0]?.toLocaleLowerCase("es");
  if (command === "/buscar" && parts.length > 1) return { tool: "buscar", query: parts.slice(1).join(" ") };
  if (command === "/contrato" && parts.length === 2) return { tool: "obtener", contract_id: parts[1]! };
  if (command === "/vencen" && parts.length === 1) return { tool: "vencimientos" };
  if (command === "/proponer" && parts.length >= 4) {
    const [, contract_id, field, ...values] = parts;
    const value = values.join(" ");
    const typedField = field!.toLocaleLowerCase("es");
    if (typedField === "status" || typedField === "owner" || typedField === "end_date") {
      return { tool: "proponer_cambio", contract_id: contract_id!, field: { field: typedField, value } };
    }
  }
  throw new Error("Comando no reconocido. Usa /buscar texto, /contrato ID, /vencen o /proponer ID owner|status|end_date valor.");
}

async function sendMessage(message: string): Promise<void> {
  addMessage("user", message);
  sendButton.disabled = true;
  try {
    const request = parseCommand(message);
    const response = await fetch("/api/tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await response.json() as ToolInvocation & { error?: string };
    if (!response.ok) throw new Error(result.error ?? `Error HTTP ${response.status}`);
    addToolCard(result);
    addMessage("assistant", result.status === "awaiting_human_approval"
      ? `Preparé una propuesta para ${String(result.output.proposal_id)}. No se guardará hasta que la apruebes.`
      : `Consulta completada. ${Array.isArray(result.output.results) ? `${result.output.results.length} resultado(s).` : ""}`);
    if ((result.input as { tool?: string }).tool === "vencimientos") {
      expiryCount.textContent = String((result.output.results as unknown[]).length);
    }
  } catch (error) {
    addMessage("assistant", error instanceof Error ? error.message : "No se pudo procesar la solicitud.");
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
}

async function refreshExpiryCount(): Promise<void> {
  try {
    const response = await fetch("/api/tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "vencimientos" }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const invocation = await response.json() as ToolInvocation;
    expiryCount.textContent = String((invocation.output.results as unknown[]).length);
    expiryCount.title = "Alertas calculadas con el corte histórico";
  } catch (error) {
    expiryCount.textContent = "!";
    expiryCount.title = `No se pudieron cargar alertas: ${error instanceof Error ? error.message : "error desconocido"}`;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  void sendMessage(message);
});

document.querySelectorAll<HTMLButtonElement>(".quick-action").forEach((button) => {
  button.addEventListener("click", () => void sendMessage(button.dataset.command ?? ""));
});
document.querySelector<HTMLButtonElement>("#expiry-button")?.addEventListener("click", () => void sendMessage("/vencen"));
void refreshExpiryCount();
