export async function listTickets({ q = "", status = "", assignee = "" } = {}) {
  const usp = new URLSearchParams();
  if (q) usp.set("q", q);
  if (status) usp.set("status", status);
  if (assignee) usp.set("assignee", assignee);

  const r = await fetch(`/api/tickets?${usp.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Falha ao listar tickets (${r.status})`);
  return r.json();
}

export async function getTicketTransitions(ticketKey) {
  const tk = String(ticketKey || "")
    .trim()
    .toUpperCase();
  const r = await fetch(`/api/tickets/${encodeURIComponent(tk)}/transitions`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Falha ao carregar transitions (${r.status})`);
  return r.json();
}

export async function getTicketCronograma(ticketKey) {
  const tk = String(ticketKey || "")
    .trim()
    .toUpperCase();
  const r = await fetch(`/api/tickets/${encodeURIComponent(tk)}/cronograma`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Falha ao carregar cronograma (${r.status})`);
  return r.json();
}

export async function getTicketKanban(ticketKey) {
  const tk = String(ticketKey || "")
    .trim()
    .toUpperCase();
  const r = await fetch(`/api/tickets/${encodeURIComponent(tk)}/kanban`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Falha ao carregar kanban (${r.status})`);
  return r.json();
}
