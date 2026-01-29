export async function getAutomation(ticketKey) {
  const tk = String(ticketKey || "")
    .trim()
    .toUpperCase();
  const r = await fetch(`/api/tickets/${encodeURIComponent(tk)}/automation`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Falha ao carregar automação (${r.status})`);
  return r.json();
}

export async function saveAutomation(ticketKey, payload) {
  const tk = String(ticketKey || "")
    .trim()
    .toUpperCase();
  const r = await fetch(`/api/tickets/${encodeURIComponent(tk)}/automation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Falha ao salvar automação (${r.status})`);
  return r.json();
}

export async function dryRunAutomation(ticketKey, rules) {
  const tk = String(ticketKey || "")
    .trim()
    .toUpperCase();
  const r = await fetch(`/api/automation/dry-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ticketKey: tk, rules }),
  });
  if (!r.ok) throw new Error(`Falha no dry-run (${r.status})`);
  return r.json();
}
