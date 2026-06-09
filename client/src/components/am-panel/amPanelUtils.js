export function normalizePlain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function fmtDateBr(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const ymd = String(yyyyMmDd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return String(yyyyMmDd);
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export function extractYmd(v) {
  if (!v) return "";

  if (typeof v === "string") {
    const ymd = v.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof v === "object") {
    const candidate =
      v?.value ||
      v?.date ||
      v?.start ||
      v?.end ||
      v?.startDate ||
      v?.endDate;
    return extractYmd(candidate);
  }

  return "";
}

export function parseIsoYmdLocal(ymd) {
  const raw = String(ymd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function startOfTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function diffDays(a, b) {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  const day = 24 * 60 * 60 * 1000;
  return Math.round((da.getTime() - db.getTime()) / day);
}

export function getTicketStatusName(t) {
  return t?.statusName || t?.fields?.status?.name || t?.status?.name || "";
}

export function getIssueKey(issue) {
  return String(issue?.key || issue?.issueKey || issue?.id || "")
    .trim()
    .toUpperCase();
}

export function getReportDueYmd(issue) {
  return extractYmd(
    issue?.dueDateRaw ||
      issue?.dueDate ||
      issue?.duedate ||
      issue?.fields?.customfield_11519 ||
      issue?.fields?.duedate,
  );
}

export function isReportIssueDone(issue) {
  const status = normalizePlain(getTicketStatusName(issue));
  return ["done", "concluido", "fechado", "closed", "resolved"].includes(
    status,
  );
}

export function isReportIssueOverdue(issue, today = startOfTodayLocal()) {
  if (isReportIssueDone(issue)) return false;
  const due = parseIsoYmdLocal(getReportDueYmd(issue));
  return Boolean(due && diffDays(today, due) > 0);
}

export function priorityColor(priorityName) {
  const normalized = normalizePlain(priorityName);
  if (normalized.includes("highest")) return "#b91c1c";
  if (normalized.includes("high")) return "#d97706";
  if (normalized.includes("medium")) return "#3b82f6";
  if (normalized.includes("low")) return "#22c55e";
  return "#6b7280";
}
