// src/components/TimesheetPanel.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  getTimesheet,
  setTimesheetDevelopers,
  setTimesheetEstimate,
  upsertTimesheetEntry,
} from "@/utils/timesheetApi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
} from "lucide-react";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ReferenceLine,
} from "recharts";

import {
  buildKanbanSummary,
  isDoneStatus,
  normalizeKey,
} from "../utils/kanbanSync";

function toIsoLocalDate(d = new Date()) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toIsoLocalDate(dt);
}

function startOfWeek(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0..6 (Sun..Sat)
  const delta = day === 0 ? -6 : 1 - day; // Monday start
  dt.setDate(dt.getDate() + delta);
  return toIsoLocalDate(dt);
}

function clampHours(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(24, Math.max(0, n));
}

function parseHours(raw) {
  if (raw === null || raw === undefined) return 0;
  const v = String(raw).trim().replace(",", ".");
  if (!v) return 0;
  const n = Number(v);
  return clampHours(n);
}

function slugId(name) {
  const base = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 24);
  const suf = Math.random().toString(36).slice(2, 6);
  return `${base || "dev"}-${suf}`;
}

function uniqueDevs(developers, entries) {
  const list = Array.isArray(developers) ? [...developers] : [];
  const byId = new Map(list.map((d) => [d.id, d]));

  for (const e of Array.isArray(entries) ? entries : []) {
    const id = String(e?.devId || "").trim();
    if (!id) continue;
    if (!byId.has(id)) {
      byId.set(id, { id, name: id });
      list.push({ id, name: id });
    }
  }
  return list;
}

function extractTasks(kanbanCfg, jiraCtx) {
  const out = [];
  const columns = kanbanCfg?.columns || {};

  for (const stepKey of Object.keys(columns)) {
    const col = columns?.[stepKey] || {};
    const stepTitle = col?.title || stepKey;

    for (const card of col?.cards || []) {
      const cardTitle = card?.title || "";

      for (const st of card?.subtasks || []) {
        const subTitle = st?.title || "";

        const summary = buildKanbanSummary({
          stepTitle,
          cardTitle,
          subTitle,
        });
        const mapKey = normalizeKey(summary);
        const jira = jiraCtx?.subtasksBySummary?.[mapKey] || null;

        const jiraKey = String(st?.jiraKey || jira?.key || "").trim();
        const taskKey = jiraKey || `sum:${mapKey}`;

        out.push({
          taskKey,
          jiraKey,
          mapKey,
          title: subTitle || summary,
          stepKey,
          stepTitle,
          cardTitle,
          status: jira?.status || st?.jiraStatus || "",
          done: jira ? isDoneStatus(jira) : Boolean(st?.done),
        });
      }
    }
  }

  const seen = new Set();
  return out.filter((t) => {
    if (!t?.taskKey) return false;
    if (seen.has(t.taskKey)) return false;
    seen.add(t.taskKey);
    return true;
  });
}

function rangeDays(from, to) {
  const out = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function isoDow(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][dt.getDay()];
}

export default function TimesheetPanel({ ticketKey, kanbanCfg, jiraCtx }) {
  const today = useMemo(() => toIsoLocalDate(), []);

  const [periodMode, setPeriodMode] = useState("week"); // 'day' | 'week'
  const [anchorDate, setAnchorDate] = useState(today);
  const [devFilter, setDevFilter] = useState("all"); // 'all' | devId

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [timesheet, setTimesheet] = useState({
    developers: [],
    estimates: {},
    entries: [],
    updatedAt: null,
  });

  const [newDevName, setNewDevName] = useState("");

  // Drafts
  const [draftHours, setDraftHours] = useState({}); // cellKey -> string
  const [draftEstimates, setDraftEstimates] = useState({}); // taskKey -> string

  // Debounce queue
  const queueRef = useRef(new Map());
  const [queuedCount, setQueuedCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    return () => {
      for (const v of queueRef.current.values()) clearTimeout(v);
      queueRef.current.clear();
    };
  }, []);

  function queueSave(key, fn) {
    if (queueRef.current.has(key)) clearTimeout(queueRef.current.get(key));

    const t = setTimeout(async () => {
      queueRef.current.delete(key);
      setQueuedCount(queueRef.current.size);

      setPendingCount((p) => p + 1);
      setErr("");
      try {
        const resp = await fn();
        const ts = resp?.timesheet || resp;
        if (ts) setTimesheet(ts);
      } catch (e) {
        setErr(e?.message || "Erro ao salvar");
      } finally {
        setPendingCount((p) => Math.max(0, p - 1));
      }
    }, 450);

    queueRef.current.set(key, t);
    setQueuedCount(queueRef.current.size);
  }

  const saveLabel = useMemo(() => {
    if (pendingCount > 0 || queuedCount > 0) return "Salvando…";
    return "Salvo";
  }, [pendingCount, queuedCount]);

  const { from, to, days } = useMemo(() => {
    if (periodMode === "day") {
      return { from: anchorDate, to: anchorDate, days: [anchorDate] };
    }
    const f = startOfWeek(anchorDate);
    const t = addDays(f, 6);
    return { from: f, to: t, days: rangeDays(f, t) };
  }, [periodMode, anchorDate]);

  const tasks = useMemo(
    () => extractTasks(kanbanCfg, jiraCtx),
    [kanbanCfg, jiraCtx]
  );
  const developers = useMemo(
    () => uniqueDevs(timesheet?.developers, timesheet?.entries),
    [timesheet]
  );

  const entries = useMemo(() => {
    const all = Array.isArray(timesheet?.entries) ? timesheet.entries : [];
    return all.filter((e) => {
      const d = String(e?.date || "");
      if (!d) return false;
      return d >= from && d <= to;
    });
  }, [timesheet, from, to]);

  const entryIndex = useMemo(() => {
    const m = new Map();
    for (const e of entries) m.set(`${e.devId}|${e.taskKey}|${e.date}`, e);
    return m;
  }, [entries]);

  const totalsByDev = useMemo(() => {
    const map = new Map();
    for (const d of developers) map.set(d.id, 0);
    for (const e of entries) {
      const id = String(e?.devId || "");
      if (!id) continue;
      map.set(id, (map.get(id) || 0) + Number(e?.hours || 0));
    }
    const list = Array.from(map.entries()).map(([id, hours]) => ({
      devId: id,
      name: developers.find((d) => d.id === id)?.name || id,
      hours,
    }));
    list.sort((a, b) => b.hours - a.hours);
    return list;
  }, [developers, entries]);

  const totalsByDay = useMemo(() => {
    const map = {};
    for (const iso of days) map[iso] = 0;
    for (const e of entries)
      if (map[e.date] != null) map[e.date] += Number(e?.hours || 0);
    return map;
  }, [entries, days]);

  const totalsByTask = useMemo(() => {
    const map = new Map(tasks.map((t) => [t.taskKey, 0]));
    for (const e of timesheet.entries || []) {
      const tk = e.taskKey;
      if (map.has(tk)) {
        map.set(tk, map.get(tk) + Number(e.hours || 0));
      }
    }
    return map;
  }, [timesheet.entries, tasks]);

  const taskProgressData = useMemo(() => {
    return tasks
      .map((t) => {
        const est = parseHours(timesheet.estimates[t.taskKey] || 0);
        const act = totalsByTask.get(t.taskKey) || 0;
        const percent = est > 0 ? (act / est) * 100 : 0;
        return {
          name: t.title,
          onTime: Math.min(100, percent),
          over: Math.max(0, percent - 100),
          actual: act,
          estimate: est,
          percent,
        };
      })
      .filter((d) => d.estimate > 0);
  }, [tasks, timesheet.estimates, totalsByTask]);

  const totalPeriodHours = useMemo(
    () => totalsByDev.reduce((acc, d) => acc + (d.hours || 0), 0),
    [totalsByDev]
  );

  // Load once per ticket
  useEffect(() => {
    async function load() {
      if (!ticketKey) return;
      setLoading(true);
      setErr("");
      try {
        const resp = await getTimesheet(ticketKey);
        const ts = resp?.timesheet || resp;
        setTimesheet(
          ts || { developers: [], estimates: {}, entries: [], updatedAt: null }
        );
      } catch (e) {
        setErr(e?.message || "Erro ao carregar timesheet");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [ticketKey]);

  async function persistDevelopers(next) {
    if (!ticketKey) return;
    setErr("");
    setPendingCount((p) => p + 1);
    try {
      const resp = await setTimesheetDevelopers(ticketKey, {
        developers: next,
      });
      const ts = resp?.timesheet || resp;
      if (ts) setTimesheet(ts);
    } catch (e) {
      setErr(e?.message || "Erro ao salvar desenvolvedores");
    } finally {
      setPendingCount((p) => Math.max(0, p - 1));
    }
  }

  function addDeveloper() {
    const name = String(newDevName || "").trim();
    if (!name) return;
    const next = [...developers, { id: slugId(name), name }];
    setNewDevName("");
    persistDevelopers(next);
    setDevFilter(next[next.length - 1].id);
  }

  function removeDeveloper(devId) {
    const next = developers.filter((d) => d.id !== devId);
    if (devFilter === devId) setDevFilter("all");
    persistDevelopers(next);
  }

  function setEstimateLocal(taskKey, raw) {
    setDraftEstimates((prev) => ({ ...prev, [taskKey]: raw }));
    const hours = parseHours(raw);
    queueSave(`est|${taskKey}`, () =>
      setTimesheetEstimate(ticketKey, { taskKey, hours })
    );
  }

  function setHoursLocal(devId, taskKey, date, raw) {
    const cellKey = `${devId}|${taskKey}|${date}`;
    setDraftHours((prev) => ({ ...prev, [cellKey]: raw }));
    const hours = parseHours(raw);
    queueSave(`e|${cellKey}`, () =>
      upsertTimesheetEntry(ticketKey, { devId, taskKey, date, hours })
    );
  }

  function readEstimate(taskKey) {
    const raw = draftEstimates?.[taskKey];
    if (raw !== undefined) return raw;
    const v = timesheet?.estimates?.[taskKey];
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function readCell(devId, taskKey, date) {
    const cellKey = `${devId}|${taskKey}|${date}`;
    const raw = draftHours?.[cellKey];
    if (raw !== undefined) return raw;
    const e = entryIndex.get(cellKey);
    if (!e) return "";
    return e.hours === 0 ? "" : String(e.hours);
  }

  function sumTask(taskKey, dateList) {
    let total = 0;
    for (const iso of dateList) {
      if (devFilter === "all") {
        for (const d of developers)
          total += Number(
            entryIndex.get(`${d.id}|${taskKey}|${iso}`)?.hours || 0
          );
      } else {
        total += Number(
          entryIndex.get(`${devFilter}|${taskKey}|${iso}`)?.hours || 0
        );
      }
    }
    return total;
  }

  function setPrev() {
    setAnchorDate(addDays(anchorDate, periodMode === "day" ? -1 : -7));
  }

  function setNext() {
    setAnchorDate(addDays(anchorDate, periodMode === "day" ? 1 : 7));
  }

  const canEdit = devFilter !== "all";

  const colors = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#3b82f6",
    "#6366f1",
    "#8b5cf6",
    "#ec4899",
  ];

  const chartHeight = Math.min(
    600,
    Math.max(200, taskProgressData.length * 30)
  );

  return (
    <TooltipProvider>
      <div className="w-full">
        {err && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}

        <Card className="rounded-2xl border-zinc-200">
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">Timesheet</CardTitle>
                <Badge className="border border-red-200 bg-red-50 text-red-700">
                  {from === to ? from : `${from} → ${to}`}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Tabs value={periodMode} onValueChange={setPeriodMode}>
                  <TabsList className="h-9 rounded-xl border border-zinc-200 bg-white">
                    <TabsTrigger value="day" className="rounded-lg">
                      Dia
                    </TabsTrigger>
                    <TabsTrigger value="week" className="rounded-lg">
                      Semana
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-xl"
                    onClick={setPrev}
                    aria-label="Período anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  <Input
                    type="date"
                    value={anchorDate}
                    onChange={(e) => setAnchorDate(e.target.value)}
                    className="h-9 w-[160px] rounded-xl"
                    aria-label="Data base"
                  />

                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-xl"
                    onClick={setNext}
                    aria-label="Próximo período"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <Select value={devFilter} onValueChange={setDevFilter}>
                  <SelectTrigger className="h-9 w-[220px] rounded-xl">
                    <SelectValue placeholder="Desenvolvedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos (somente leitura)</SelectItem>
                    {developers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
                  {pendingCount > 0 || queuedCount > 0 ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  <span>{saveLabel}</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-zinc-900">
                    Desenvolvedores
                  </div>
                  <div className="text-xs text-zinc-500">
                    {developers.length} no ticket
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    value={newDevName}
                    onChange={(e) => setNewDevName(e.target.value)}
                    className="h-9 rounded-xl"
                    placeholder="Adicionar dev (nome)"
                    aria-label="Adicionar desenvolvedor"
                  />
                  <Button
                    type="button"
                    onClick={addDeveloper}
                    className="h-9 rounded-xl bg-red-600 text-white hover:bg-red-700"
                    disabled={!newDevName.trim() || !ticketKey}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {developers.length === 0 ? (
                    <div className="text-xs text-zinc-500">
                      Cadastre pelo menos 1 desenvolvedor para lançar horas.
                    </div>
                  ) : (
                    developers.map((d) => (
                      <div
                        key={d.id}
                        className={cn(
                          "group flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2",
                          devFilter === d.id && "border-red-200 bg-red-50"
                        )}
                      >
                        <div className="grid h-7 w-7 place-items-center rounded-lg bg-white text-xs font-bold text-zinc-700 shadow-sm">
                          {String(d.name || "?")
                            .trim()
                            .slice(0, 1)
                            .toUpperCase()}
                        </div>
                        <div className="text-sm text-zinc-800">{d.name}</div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="ml-1 h-7 w-7 rounded-lg p-0 text-zinc-500 opacity-0 hover:bg-white hover:text-zinc-800 group-hover:opacity-100"
                          onClick={() => removeDeveloper(d.id)}
                          aria-label={`Remover ${d.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-zinc-900">
                    Horas por dev (período)
                  </div>
                  <div className="text-xs text-zinc-500">
                    Total: {totalPeriodHours.toFixed(2).replace(/\.00$/, "")}h
                  </div>
                </div>

                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={totalsByDev}
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <ReTooltip />
                      <Bar
                        dataKey="hours"
                        fill={(entry, index) => colors[index % colors.length]}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-900">
                  Progresso por Tarefa
                </div>
                <div className="text-xs text-zinc-500">
                  Atual vs Estimativa (total no ticket)
                </div>
              </div>

              {taskProgressData.length === 0 ? (
                <div className="py-6 text-center text-sm text-zinc-500">
                  Defina estimativas nas tarefas para ver o progresso.
                </div>
              ) : (
                <div className="w-full" style={{ height: `${chartHeight}px` }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={taskProgressData}
                      margin={{ top: 8, right: 8, left: 100, bottom: 8 }}
                    >
                      <XAxis
                        type="number"
                        domain={[0, "dataMax"]}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        width={120}
                      />
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <ReTooltip
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="rounded bg-white p-2 shadow">
                                <p className="font-semibold">{label}</p>
                                <p>
                                  Atual:{" "}
                                  {d.actual.toFixed(2).replace(/\.00$/, "")}h
                                </p>
                                <p>
                                  Estimativa:{" "}
                                  {d.estimate.toFixed(2).replace(/\.00$/, "")}h
                                </p>
                                <p>Percentual: {d.percent.toFixed(1)}%</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar
                        dataKey="onTime"
                        stackId="progress"
                        fill="#22c55e"
                        radius={[0, 0, 4, 4]}
                      />
                      <Bar
                        dataKey="over"
                        stackId="progress"
                        fill="#ef4444"
                        radius={[0, 4, 4, 0]}
                      />
                      <ReferenceLine
                        x={100}
                        stroke="#000"
                        strokeDasharray="3 3"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-900">Tarefas</div>
              <div className="text-xs text-zinc-500">
                {tasks.length} tarefas derivadas do Kanban
              </div>
            </div>

            {loading ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
                Carregando timesheet…
              </div>
            ) : tasks.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
                Sem tarefas para apontar. Sincronize o Kanban com o Jira.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-zinc-50">
                    <tr className="border-b border-zinc-200">
                      <th className="p-3 text-left font-semibold text-zinc-700">
                        Tarefa
                      </th>
                      <th className="p-3 text-left font-semibold text-zinc-700 w-[140px]">
                        Estimativa (h)
                      </th>
                      {days.map((iso) => (
                        <th
                          key={iso}
                          className="p-3 text-center font-semibold text-zinc-700 w-[110px]"
                        >
                          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                            {isoDow(iso)}
                          </div>
                          <div>
                            {iso.slice(8, 10)}/{iso.slice(5, 7)}
                          </div>
                        </th>
                      ))}
                      <th className="p-3 text-center font-semibold text-zinc-700 w-[120px]">
                        Total
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {tasks.map((t) => {
                      const rowTotal = sumTask(t.taskKey, days);
                      return (
                        <tr
                          key={t.taskKey}
                          className="border-b border-zinc-100 hover:bg-zinc-50"
                        >
                          <td className="p-3 align-top">
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-semibold text-zinc-900">
                                  {t.title}
                                </div>
                                {t.done ? (
                                  <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
                                    Done
                                  </Badge>
                                ) : t.status ? (
                                  <Badge className="border border-zinc-200 bg-white text-zinc-700">
                                    {t.status}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="text-xs text-zinc-500">
                                {t.stepTitle}
                                {t.cardTitle ? ` · ${t.cardTitle}` : ""}
                              </div>
                            </div>
                          </td>

                          <td className="p-3 align-top">
                            <Input
                              type="number"
                              min={0}
                              max={999}
                              step={0.5}
                              value={readEstimate(t.taskKey)}
                              onChange={(e) =>
                                setEstimateLocal(t.taskKey, e.target.value)
                              }
                              className="h-9 w-[120px] rounded-xl"
                              aria-label={`Estimativa ${t.title}`}
                              disabled={!ticketKey}
                            />
                          </td>

                          {days.map((iso) => {
                            const cellTotalAll =
                              devFilter === "all"
                                ? developers.reduce(
                                    (s, d) =>
                                      s +
                                      Number(
                                        entryIndex.get(
                                          `${d.id}|${t.taskKey}|${iso}`
                                        )?.hours || 0
                                      ),
                                    0
                                  )
                                : null;

                            return (
                              <td
                                key={iso}
                                className="p-3 text-center align-top"
                              >
                                {devFilter === "all" ? (
                                  <div className="text-xs text-zinc-600">
                                    {cellTotalAll
                                      ? cellTotalAll
                                          .toFixed(2)
                                          .replace(/\.00$/, "")
                                      : "–"}
                                  </div>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Input
                                        type="number"
                                        min={0}
                                        max={24}
                                        step={0.5}
                                        value={readCell(
                                          devFilter,
                                          t.taskKey,
                                          iso
                                        )}
                                        onChange={(e) =>
                                          setHoursLocal(
                                            devFilter,
                                            t.taskKey,
                                            iso,
                                            e.target.value
                                          )
                                        }
                                        className={cn(
                                          "h-9 w-[90px] rounded-xl text-center",
                                          !canEdit && "opacity-60"
                                        )}
                                        aria-label={`Horas em ${iso} para ${t.title}`}
                                        disabled={
                                          !ticketKey ||
                                          !canEdit ||
                                          developers.length === 0
                                        }
                                      />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="text-xs">
                                        0–24h (step 0.5)
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </td>
                            );
                          })}

                          <td className="p-3 text-center align-top font-semibold text-zinc-900">
                            {rowTotal
                              ? rowTotal.toFixed(2).replace(/\.00$/, "")
                              : "0"}
                          </td>
                        </tr>
                      );
                    })}

                    <tr className="bg-zinc-50">
                      <td className="p-3 font-semibold text-zinc-900">
                        Totais
                      </td>
                      <td className="p-3 text-zinc-600"></td>
                      {days.map((iso) => (
                        <td
                          key={iso}
                          className="p-3 text-center font-semibold text-zinc-900"
                        >
                          {(totalsByDay[iso] || 0)
                            .toFixed(2)
                            .replace(/\.00$/, "")}
                        </td>
                      ))}
                      <td className="p-3 text-center font-semibold text-zinc-900">
                        {totalPeriodHours.toFixed(2).replace(/\.00$/, "")}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {!canEdit && (
                  <div className="border-t border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                    Selecione um desenvolvedor para lançar/editar horas. Em
                    “Todos”, a tabela mostra a soma por célula.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
