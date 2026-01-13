// src/components/AMPanelTab.jsx
import React, { useEffect, useMemo, useState } from "react";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

import {
  fetchPoIssuesDetailed,
  buildPoView,
  makeDefaultCronogramaDraft,
  saveCronogramaToJira,
  applyEventChangeToAtividades,
} from "../lib/jiraPoView";
import { buildCronogramaADF } from "../utils/cronograma";
import { jiraEditIssue } from "../lib/jiraClient";

export default function AMPanelTab() {
  const [subView, setSubView] = useState("alertas"); // alertas | calendario
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [rawIssues, setRawIssues] = useState([]);
  const [viewData, setViewData] = useState({
    alertas: [],
    criarCronograma: [],
    calendarioIssues: [],
    events: [],
  });

  // modal cronograma
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorIssue, setEditorIssue] = useState(null);
  const [draft, setDraft] = useState([]);

  async function reload() {
    setLoading(true);
    setErr("");
    try {
      const detailed = await fetchPoIssuesDetailed({ concurrency: 8 });
      setRawIssues(detailed);
      setViewData(buildPoView(detailed));
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Falha ao carregar dados do Jira.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const filteredAlertas = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return viewData.alertas;
    return viewData.alertas.filter((t) => {
      return (
        t.key.toLowerCase().includes(qq) ||
        (t.summary || "").toLowerCase().includes(qq) ||
        (t.assignee || "").toLowerCase().includes(qq)
      );
    });
  }, [viewData.alertas, q]);

  const filteredCriarCronograma = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return viewData.criarCronograma;
    return viewData.criarCronograma.filter((t) => {
      return (
        t.key.toLowerCase().includes(qq) ||
        (t.summary || "").toLowerCase().includes(qq) ||
        (t.assignee || "").toLowerCase().includes(qq)
      );
    });
  }, [viewData.criarCronograma, q]);

  const calendarEvents = useMemo(() => viewData.events, [viewData.events]);

  function openEditor(issue) {
    setEditorIssue(issue);
    setDraft(makeDefaultCronogramaDraft());
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorIssue(null);
    setDraft([]);
  }

  async function saveEditor() {
    if (!editorIssue) return;
    setLoading(true);
    setErr("");
    try {
      await saveCronogramaToJira(editorIssue.key, draft);
      closeEditor();
      await reload();
      setSubView("calendario");
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Falha ao salvar cronograma no Jira.");
    } finally {
      setLoading(false);
    }
  }

  // ---- drag/resize do calendário → atualiza ADF e persiste no Jira
  async function persistEventChange(info) {
    const issueKey = info.event.extendedProps?.issueKey;
    const activityId = info.event.extendedProps?.activityId;
    if (!issueKey || !activityId) return;

    // snapshot para rollback manual
    const prev = viewData.calendarioIssues.map((x) => ({
      key: x.key,
      atividades: x.atividades?.map((a) => ({ ...a })) || [],
    }));

    // otimista: ajusta no state
    const nextCalendarioIssues = viewData.calendarioIssues.map((iss) => {
      if (iss.key !== issueKey) return iss;
      const nextAtividades = applyEventChangeToAtividades(
        iss.atividades,
        activityId,
        info.event.start,
        info.event.end
      );
      return { ...iss, atividades: nextAtividades };
    });

    const nextEvents = nextCalendarioIssues.flatMap((i) => {
      // reusa buildPoView? aqui é direto: recomputa pelo cronograma atual
      // para manter simples, mantemos o events pela função buildPoView recarregando depois.
      // mas precisamos refletir imediatamente: montamos ADF e parse → eventos não é necessário,
      // FullCalendar já moveu o evento visualmente.
      return [];
    });

    setViewData((v) => ({
      ...v,
      calendarioIssues: nextCalendarioIssues,
      // não precisa mexer em events; FullCalendar já moveu visualmente o evento
      // e a próxima recarga alinhará tudo
    }));

    try {
      const issue = nextCalendarioIssues.find((x) => x.key === issueKey);
      const adf = buildCronogramaADF(issue.atividades);

      await jiraEditIssue(issueKey, {
        fields: {
          customfield_14017: adf,
        },
      });

      // opcional: recarregar para garantir consistência
      await reload();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Falha ao persistir no Jira. Revertendo...");

      // reverte UI do calendário
      info.revert();

      // reverte state local
      setViewData((v) => {
        const restored = v.calendarioIssues.map((iss) => {
          const snap = prev.find((p) => p.key === iss.key);
          if (!snap) return iss;
          return { ...iss, atividades: snap.atividades };
        });
        return { ...v, calendarioIssues: restored };
      });
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por chave, resumo, responsável..."
          style={{ minWidth: 320, flex: 1 }}
        />

        <button
          type="button"
          className={`main-tab ${subView === "alertas" ? "active" : ""}`}
          onClick={() => setSubView("alertas")}
        >
          Alertas
        </button>

        <button
          type="button"
          className={`main-tab ${subView === "calendario" ? "active" : ""}`}
          onClick={() => setSubView("calendario")}
        >
          Calendário
        </button>

        <button
          type="button"
          className="primary"
          onClick={reload}
          disabled={loading}
        >
          {loading ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {err && (
        <div
          style={{
            padding: 10,
            border: "1px solid rgba(255,80,80,0.35)",
            background: "rgba(255,80,80,0.08)",
            borderRadius: 10,
          }}
        >
          {err}
        </div>
      )}

      {subView === "alertas" && (
        <section style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0 }}>
            Alertas / Tickets novos (PRE SAVE sem [INICIADO])
          </h2>
          <TicketsTable
            rows={filteredAlertas}
            emptyText="Nenhum alerta encontrado."
          />

          <h2 style={{ margin: "14px 0 0" }}>
            Criar cronograma de implantação
          </h2>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            Tickets em andamento sem <code>customfield_14017</code> preenchido.
          </div>
          <TicketsTable
            rows={filteredCriarCronograma}
            emptyText="Nenhum ticket pendente de cronograma."
            extraActions={(t) => (
              <button
                type="button"
                className="primary"
                onClick={() => openEditor(t)}
              >
                Criar cronograma
              </button>
            )}
          />
        </section>
      )}

      {subView === "calendario" && (
        <section style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Calendário (cronograma por atividade)</h2>

          <div style={{ overflowX: "auto" }}>
            <FullCalendar
              plugins={[dayGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              height="auto"
              editable
              selectable={false}
              eventStartEditable
              eventDurationEditable
              events={calendarEvents}
              eventDrop={persistEventChange}
              eventResize={persistEventChange}
            />
          </div>

          <div style={{ opacity: 0.8, fontSize: 13 }}>
            Arraste eventos para mudar data; redimensione para alterar
            intervalo. As alterações atualizam o <code>customfield_14017</code>{" "}
            no Jira (otimista + revert em erro).
          </div>
        </section>
      )}

      {editorOpen && (
        <CronogramaEditorModal
          issue={editorIssue}
          draft={draft}
          setDraft={setDraft}
          onClose={closeEditor}
          onSave={saveEditor}
          loading={loading}
        />
      )}
    </div>
  );
}

function TicketsTable({ rows, emptyText, extraActions }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <Th>Ticket</Th>
            <Th>Resumo</Th>
            <Th>Status</Th>
            <Th>Responsável</Th>
            <Th>Atualizado</Th>
            {extraActions ? <Th /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.key}>
              <Td style={{ fontWeight: 700 }}>{t.key}</Td>
              <Td>{t.summary}</Td>
              <Td>{t.statusName}</Td>
              <Td>{t.assignee}</Td>
              <Td>{t.updated}</Td>
              {extraActions ? <Td>{extraActions(t)}</Td> : null}
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <Td colSpan={extraActions ? 6 : 5} style={{ opacity: 0.7 }}>
                {emptyText}
              </Td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CronogramaEditorModal({
  issue,
  draft,
  setDraft,
  onClose,
  onSave,
  loading,
}) {
  if (!issue) return null;

  function setCell(idx, key, value) {
    setDraft((prev) => {
      const next = prev.map((x) => ({ ...x }));
      next[idx][key] = value;
      return next;
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: "min(980px, 98vw)",
          background: "rgba(20,20,20,0.96)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          padding: 14,
          display: "grid",
          gap: 12,
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontWeight: 800 }}>
              Criar cronograma — {issue.key}
            </div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>{issue.summary}</div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>
              Data aceita: <code>DD/MM</code> ou <code>DD/MM a DD/MM</code>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="primary"
              onClick={onSave}
              disabled={loading}
            >
              {loading ? "Salvando..." : "Salvar no Jira"}
            </button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Atividade</Th>
                <Th>Data</Th>
                <Th>Recurso</Th>
                <Th>Área</Th>
              </tr>
            </thead>
            <tbody>
              {draft.map((a, idx) => (
                <tr key={a.id}>
                  <Td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                    {a.name}
                  </Td>
                  <Td>
                    <input
                      value={a.data}
                      onChange={(e) => setCell(idx, "data", e.target.value)}
                      placeholder="ex.: 15/01 ou 15/01 a 18/01"
                      style={{ width: "100%" }}
                    />
                  </Td>
                  <Td>
                    <input
                      value={a.recurso}
                      onChange={(e) => setCell(idx, "recurso", e.target.value)}
                      placeholder="ex.: João"
                      style={{ width: "100%" }}
                    />
                  </Td>
                  <Td>
                    <input
                      value={a.area}
                      onChange={(e) => setCell(idx, "area", e.target.value)}
                      placeholder="ex.: TI"
                      style={{ width: "100%" }}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details style={{ opacity: 0.85 }}>
          <summary>Prévia do ADF gerado</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {JSON.stringify(buildCronogramaADF(draft), null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style, colSpan }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
