// src/components/KanbanBuilderModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Sortable from "sortablejs";

function ensureDefaultSelection(workflow, library) {
  const w = workflow || [];
  const libIds = new Set((library || []).map((c) => c.id));

  const out = {};
  for (const step of w) {
    const defaults = Array.isArray(step.defaultTemplateIds)
      ? step.defaultTemplateIds
      : [];
    out[step.key] = defaults.map(String).filter((id) => libIds.has(id));
  }
  return out;
}

export default function KanbanBuilderModal({
  open,
  onClose,
  library,
  workflow,
  onSave,
}) {
  const lib = Array.isArray(library) ? library : [];
  const wf = Array.isArray(workflow) ? workflow : [];

  const libById = useMemo(() => {
    const o = {};
    for (const c of lib) o[c.id] = c;
    return o;
  }, [lib]);

  const [selectedByStepKey, setSelectedByStepKey] = useState({});
  const sortRefs = useRef({});
  const sortablesRef = useRef({});

  useEffect(() => {
    if (!open) return;
    setSelectedByStepKey(ensureDefaultSelection(wf, lib));
  }, [open, wf, lib]);

  // init Sortable por step (apenas quando modal abrir)
  useEffect(() => {
    if (!open) return;

    // cleanup antes
    for (const k of Object.keys(sortablesRef.current || {})) {
      try {
        sortablesRef.current[k]?.destroy?.();
      } catch {}
    }
    sortablesRef.current = {};

    for (const step of wf) {
      const el = sortRefs.current[step.key];
      if (!el) continue;

      sortablesRef.current[step.key] = new Sortable(el, {
        animation: 150,
        handle: "[data-handle]",
        onEnd: () => {
          // lê a ordem do DOM e aplica no estado
          const ids = Array.from(el.querySelectorAll("[data-card-id]")).map(
            (n) => n.getAttribute("data-card-id")
          );
          setSelectedByStepKey((prev) => ({ ...prev, [step.key]: ids }));
        },
      });
    }

    return () => {
      for (const k of Object.keys(sortablesRef.current || {})) {
        try {
          sortablesRef.current[k]?.destroy?.();
        } catch {}
      }
      sortablesRef.current = {};
    };
  }, [open, wf]);

  if (!open) return null;

  function toggleCard(stepKey, cardId) {
    setSelectedByStepKey((prev) => {
      const cur = Array.isArray(prev[stepKey]) ? prev[stepKey] : [];
      const has = cur.includes(cardId);
      const next = has ? cur.filter((x) => x !== cardId) : [...cur, cardId];
      return { ...prev, [stepKey]: next };
    });
  }

  function handleSave() {
    onSave?.(selectedByStepKey);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20000,
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: "min(980px, 100%)",
          maxHeight: "calc(100vh - 32px)", // <<< garante caber na tela
          display: "flex", // <<< permite header/footer fixos
          flexDirection: "column",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          border: "1px solid #eee",
          overflow: "hidden",
        }}
      >
        {/* HEADER (fixo) */}
        <div
          style={{
            padding: 14,
            borderBottom: "1px solid #eee",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            background: "#fafafa",
            flex: "0 0 auto",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 15 }}>
              Montar estrutura do Kanban (GMUD)
            </div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              Selecione os cards por step e reordene arrastando pelo “≡”.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="primary" onClick={handleSave}>
              Salvar estrutura
            </button>
          </div>
        </div>

        {/* BODY (scroll) */}
        <div
          style={{
            padding: 14,
            display: "grid",
            gap: 14,
            overflow: "auto", // <<< scroll do conteúdo
            flex: "1 1 auto",
          }}
        >
          {wf.map((step) => {
            const picked = Array.isArray(selectedByStepKey[step.key])
              ? selectedByStepKey[step.key]
              : [];

            const libForStep = lib.filter(
              (c) => !c.columnKey || c.columnKey === step.key
            );

            return (
              <div
                key={step.key}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 14,
                  overflow: "hidden",
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    padding: 10,
                    borderBottom: "1px solid #eee",
                    background: "#fff",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <i className={step.icon} aria-hidden="true" />
                  <div style={{ fontWeight: 900 }}>{step.title}</div>
                  <div
                    style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}
                  >
                    {picked.length} card(s) selecionado(s)
                  </div>
                </div>

                <div
                  style={{
                    padding: 10,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", // <<< responsivo
                    gap: 12,
                  }}
                >
                  {/* Biblioteca */}
                  <div
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 12,
                      padding: 10,
                      background: "#fafafa",
                      maxHeight: 340, // <<< limita altura
                      overflow: "auto", // <<< scroll interno se precisar
                    }}
                  >
                    <div
                      style={{ fontWeight: 900, fontSize: 12, marginBottom: 8 }}
                    >
                      Biblioteca
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      {lib.map((card) => {
                        const checked = picked.includes(card.id);
                        return (
                          <label
                            key={card.id}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              fontSize: 13,
                              padding: "6px 8px",
                              borderRadius: 10,
                              background: "#fff",
                              border: "1px solid #eee",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCard(step.key, card.id)}
                            />
                            <span style={{ fontWeight: 800 }}>
                              {card.title}
                            </span>
                            <span
                              style={{
                                marginLeft: "auto",
                                color: "#666",
                                fontSize: 12,
                              }}
                            >
                              {(card.subtasks || []).length} itens
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Selecionados */}
                  <div
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 12,
                      padding: 10,
                      background: "#fff",
                      maxHeight: 340, // <<< limita altura
                      overflow: "auto", // <<< scroll interno
                    }}
                  >
                    <div
                      style={{ fontWeight: 900, fontSize: 12, marginBottom: 8 }}
                    >
                      Selecionados (arraste para reordenar)
                    </div>

                    <div
                      ref={(el) => (sortRefs.current[step.key] = el)}
                      style={{ display: "grid", gap: 8 }}
                    >
                      {!picked.length ? (
                        <div style={{ fontSize: 12, color: "#777" }}>
                          Nenhum card selecionado para este step.
                        </div>
                      ) : (
                        picked
                          .map((id) => libById[id])
                          .filter(Boolean)
                          .map((card) => (
                            <div
                              key={card.id}
                              data-card-id={card.id}
                              style={{
                                border: "1px solid #eee",
                                borderRadius: 12,
                                padding: 10,
                                display: "flex",
                                gap: 10,
                                alignItems: "center",
                                background: "#fafafa",
                              }}
                            >
                              <button
                                type="button"
                                data-handle
                                title="Arrastar"
                                style={{
                                  cursor: "grab",
                                  border: "1px solid #ddd",
                                  borderRadius: 10,
                                  padding: "4px 8px",
                                  background: "#fff",
                                }}
                              >
                                ≡
                              </button>

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 900, fontSize: 13 }}>
                                  {card.title}
                                </div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: "#666",
                                    marginTop: 2,
                                  }}
                                >
                                  {(card.subtasks || [])
                                    .map((st) => st.title)
                                    .join(" • ")}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => toggleCard(step.key, card.id)}
                                title="Remover"
                              >
                                Remover
                              </button>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* FOOTER (fixo) */}
        <div
          style={{
            padding: 14,
            borderTop: "1px solid #eee",
            background: "#fafafa",
            flex: "0 0 auto",
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>
            Dica: após salvar, o sistema cria **somente** as subtarefas do step
            0. Os próximos steps só criam quando você clicar em{" "}
            <strong>Liberar próximo step</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}
