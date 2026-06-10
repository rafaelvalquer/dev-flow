import { DEFAULT_LAYOUTS, DEFAULT_VISIBLE_WIDGETS, EMPTY_WORKSPACE, GRID_BREAKPOINTS } from "./developerWidgetRegistry";

export function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeTicketKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function getIssueKey(issue) {
  return normalizeTicketKey(issue?.key || issue?.issueKey || issue?.ticketKey);
}

export function getSummary(issue) {
  return issue?.summary || issue?.fields?.summary || "Sem resumo";
}

export function getStatus(issue) {
  return (
    issue?.statusName ||
    issue?.fields?.status?.name ||
    issue?.status?.name ||
    issue?.status ||
    ""
  );
}

export function getPriority(issue) {
  return (
    issue?.priorityName ||
    issue?.priority ||
    issue?.fields?.priority?.name ||
    "Não informado"
  );
}

export function getAssigneeAccountId(issue) {
  return (
    issue?.assigneeAccountId ||
    issue?.fields?.assignee?.accountId ||
    issue?.assignee?.accountId ||
    ""
  );
}

export function getAssigneeName(issue) {
  return (
    issue?.assigneeDisplayName ||
    issue?.assignee ||
    issue?.fields?.assignee?.displayName ||
    "Sem responsável"
  );
}

export function extractYmd(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const ymd = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "object") {
    return extractYmd(
      value.value || value.date || value.start || value.end || value.startDate,
    );
  }
  return "";
}

export function getDueYmd(issue) {
  return extractYmd(
    issue?.customfield_11519 ||
      issue?.dueDateRaw ||
      issue?.dueDate ||
      issue?.duedate ||
      issue?.fields?.customfield_11519 ||
      issue?.fields?.duedate,
  );
}

export function parseYmdLocal(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function diffDaysFromToday(ymd) {
  const date = parseYmdLocal(ymd);
  if (!date) return null;
  return Math.round((date.getTime() - todayLocal().getTime()) / 86400000);
}

export function fmtDateBr(ymd) {
  if (!ymd) return "Sem data";
  const [y, m, d] = String(ymd).slice(0, 10).split("-");
  if (!y || !m || !d) return String(ymd);
  return `${d}/${m}/${y}`;
}

export function isDone(issue) {
  return /(done|conclu|closed|resolv|fechad)/i.test(norm(getStatus(issue)));
}

export function hasEvidence(issue) {
  const attachments = issue?.attachments || issue?.fields?.attachment || [];
  return Array.isArray(attachments) && attachments.length > 0;
}

export function isAwaitingGmud(issue) {
  return !issue?.cronogramaAdf && !issue?.kanban?.config && !issue?.hasIniciado;
}

export function priorityTone(priority) {
  const normalized = norm(priority);
  if (normalized.includes("highest") || normalized.includes("alta"))
    return "danger";
  if (normalized.includes("high")) return "warning";
  if (normalized.includes("medium") || normalized.includes("media"))
    return "info";
  if (normalized.includes("low") || normalized.includes("baixa"))
    return "success";
  return "neutral";
}

export function dueLabel(issue) {
  const ymd = getDueYmd(issue);
  if (!ymd) return "Sem data";
  const days = diffDaysFromToday(ymd);
  if (days === null) return fmtDateBr(ymd);
  if (days < 0) return `${Math.abs(days)}d atrasado`;
  if (days === 0) return "Vence hoje";
  if (days === 1) return "Amanhã";
  return fmtDateBr(ymd);
}

export function dueTone(issue) {
  const days = diffDaysFromToday(getDueYmd(issue));
  if (days === null) return "neutral";
  if (days < 0) return "danger";
  if (days <= 2) return "warning";
  return "success";
}

export function getWeekdayLabel(offset) {
  const date = todayLocal();
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function getUpdatedDate(issue) {
  const raw = issue?.updated || issue?.updatedRaw || issue?.fields?.updated;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function fmtDateTimeShort(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getProgress(issue) {
  const explicit = Number(issue?.progress || issue?.gmudProgress || 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(0, Math.min(100, Math.round(explicit)));
  }

  const status = norm(getStatus(issue));
  if (isDone(issue)) return 100;
  if (status.includes("deploy")) return 82;
  if (status.includes("homolog")) return 62;
  if (status.includes("desenvolv")) return 48;
  if (status.includes("para dev")) return 28;
  if (isAwaitingGmud(issue)) return 12;
  return hasEvidence(issue) ? 40 : 24;
}

export function relativeAccessLabel(value) {
  if (!value) return "Agora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Agora";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Agora";
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  return `Há ${Math.round(hours / 24)} dia`;
}

export function getJiraBrowseUrl(ticketKey, issue) {
  const key = normalizeTicketKey(ticketKey || getIssueKey(issue));
  if (!key) return "";
  const envBase = String(import.meta?.env?.VITE_JIRA_BROWSE_BASE || "").trim();
  let inferred = "";

  try {
    const self = issue?.self || issue?.url || "";
    if (self) {
      const url = new URL(self);
      inferred = `${url.protocol}//${url.host}`;
    }
  } catch {
    inferred = "";
  }

  const base = (envBase || inferred || "https://clarobr-jsw-tecnologia.atlassian.net")
    .replace(/\/$/, "");
  return `${base}/browse/${encodeURIComponent(key)}`;
}

export async function copyTextToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

export function stickyGridKey(noteId) {
  const id = String(noteId || "").trim();
  return id ? `sticky:${id}` : "";
}

export function getLayoutBottom(layout = []) {
  return (layout || []).reduce(
    (bottom, item) => Math.max(bottom, Number(item?.y || 0) + Number(item?.h || 0)),
    0,
  );
}

export function normalizeStickyNotes(notes) {
  return Array.isArray(notes)
    ? notes.filter((note) => note?.id && note?.text)
    : [];
}

export function ensureStickyLayouts(layouts, stickyNotes) {
  const notes = normalizeStickyNotes(stickyNotes);
  const stickyKeys = new Set(notes.map((note) => stickyGridKey(note.id)));
  const nextLayouts = {};

  Object.entries(GRID_BREAKPOINTS).forEach(([breakpoint, config]) => {
    const baseLayout = Array.isArray(layouts?.[breakpoint])
      ? layouts[breakpoint]
      : DEFAULT_LAYOUTS[breakpoint] || [];
    const cleaned = baseLayout
      .filter((item) => {
        const key = String(item?.i || "");
        return !key.startsWith("sticky:") || stickyKeys.has(key);
      })
      .map((item) => {
        const key = String(item?.i || "");
        if (!key.startsWith("sticky:")) return item;
        const width = Math.min(config.w, config.cols);
        const minW = Math.min(config.minW, config.cols);
        return {
          ...item,
          minW,
          minH: config.minH,
          w: Math.max(Number(item?.w || 0), width, minW),
          h: Math.max(Number(item?.h || 0), config.h, config.minH),
          x: Math.max(
            0,
            Math.min(Number(item?.x || 0), Math.max(0, config.cols - minW)),
          ),
        };
      });

    (DEFAULT_LAYOUTS[breakpoint] || []).forEach((defaultItem) => {
      if (!cleaned.some((item) => item.i === defaultItem.i)) {
        cleaned.push({ ...defaultItem, y: getLayoutBottom(cleaned) });
      }
    });

    notes.forEach((note, index) => {
      const key = stickyGridKey(note.id);
      if (cleaned.some((item) => item.i === key)) return;
      const width = Math.min(config.w, config.cols);
      cleaned.push({
        i: key,
        x: breakpoint === "sm" ? 0 : (index * width) % config.cols,
        y: getLayoutBottom(cleaned),
        w: width,
        h: config.h,
        minW: config.minW,
        minH: config.minH,
      });
    });

    nextLayouts[breakpoint] = cleaned;
  });

  return nextLayouts;
}

export function mergeWorkspace(base) {
  const stickyNotes = normalizeStickyNotes(base?.stickyNotes);
  const layout =
    base?.layout && Object.keys(base.layout || {}).length
      ? base.layout
      : DEFAULT_LAYOUTS;

  return {
    ...EMPTY_WORKSPACE,
    ...(base || {}),
    preferences: {
      ...EMPTY_WORKSPACE.preferences,
      ...(base?.preferences || {}),
      visibleWidgets: Array.isArray(base?.preferences?.visibleWidgets)
        ? base.preferences.visibleWidgets
        : DEFAULT_VISIBLE_WIDGETS,
    },
    layout: ensureStickyLayouts(layout, stickyNotes),
    recentTickets: Array.isArray(base?.recentTickets) ? base.recentTickets : [],
    stickyNotes,
    notesByTicket: base?.notesByTicket || {},
  };
}

export function findTicketByKey(rows, ticketKey) {
  const key = normalizeTicketKey(ticketKey);
  return (rows || []).find((issue) => getIssueKey(issue) === key) || null;
}
