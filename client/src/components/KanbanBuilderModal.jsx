// src/components/KanbanBuilderModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Sortable from "sortablejs";
import "../App.css";
import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

function ensureDefaultSelection(workflow, library) {
  const w = Array.isArray(workflow) ? workflow : [];
  const lib = Array.isArray(library) ? library : [];

  // Index library by columnKey -> Set(ids)
  const idsByColumnKey = lib.reduce((acc, c) => {
    const ck = String(c?.columnKey || "").trim();
    if (!ck) return acc;
    if (!acc[ck]) acc[ck] = new Set();
    acc[ck].add(String(c.id));
    return acc;
  }, {});

  const out = {};
  for (const step of w) {
    const defaults = Array.isArray(step.defaultTemplateIds)
      ? step.defaultTemplateIds.map(String)
      : [];

    const allowed = idsByColumnKey[String(step.key)] || new Set();
    out[step.key] = defaults.filter((id) => allowed.has(id));
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

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [selectedByStepKey, setSelectedByStepKey] = useState({});

  const sortableContainerRef = useRef(null);
  const sortableInstance = useRef(null);

  const libById = useMemo(() => {
    const o = {};
    for (const c of lib) o[String(c.id)] = c;
    return o;
  }, [lib]);

  const currentStep = wf[activeStepIndex];
  const currentStepKey = String(currentStep?.key || "").trim();

  // ✅ Cards disponíveis APENAS para o step atual (columnKey === stepKey)
  const cardsForCurrentStep = useMemo(() => {
    return lib
      .filter(
        (c) =>
          String(c?.columnKey || "").trim() === String(currentStepKey).trim()
      )
      .sort((a, b) => {
        const ao = Number(a?.order ?? 9999);
        const bo = Number(b?.order ?? 9999);
        if (ao !== bo) return ao - bo;
        return String(a?.title || "").localeCompare(String(b?.title || ""));
      });
  }, [lib, currentStepKey]);

  useEffect(() => {
    if (open) {
      setActiveStepIndex(0);
      setSelectedByStepKey(ensureDefaultSelection(wf, lib));
    }
  }, [open, wf, lib]);

  useEffect(() => {
    if (!open || !currentStep || !sortableContainerRef.current) return;

    const saveOrder = () => {
      const el = sortableContainerRef.current;
      if (!el) return;
      const ids = Array.from(el.querySelectorAll("[data-card-id]")).map((n) =>
        n.getAttribute("data-card-id")
      );
      setSelectedByStepKey((prev) => ({ ...prev, [currentStep.key]: ids }));
    };

    sortableInstance.current = new Sortable(sortableContainerRef.current, {
      animation: 150,
      handle: "[data-handle]",
      ghostClass: "claro-sortable-ghost",
      onEnd: saveOrder,
    });

    return () => {
      if (sortableInstance.current) {
        sortableInstance.current.destroy();
        sortableInstance.current = null;
      }
    };
  }, [open, activeStepIndex, currentStep?.key]);

  if (!open || !wf.length) return null;

  function toggleCard(stepKey, cardId) {
    setSelectedByStepKey((prev) => {
      const cur = Array.isArray(prev[stepKey]) ? prev[stepKey] : [];
      const has = cur.includes(cardId);
      const next = has ? cur.filter((x) => x !== cardId) : [...cur, cardId];
      return { ...prev, [stepKey]: next };
    });
  }

  const isLastStep = activeStepIndex === wf.length - 1;
  const pickedInCurrentStep = Array.isArray(selectedByStepKey[currentStep?.key])
    ? selectedByStepKey[currentStep.key]
    : [];

  // Badge de "disponíveis" deve refletir a coluna atual
  const availableCount = cardsForCurrentStep.length;

  return (
    <div
      className="kb-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="kb-modal">
        <header className="kb-header">
          <div className="kb-header-left">
            <div className="kb-logo">Claro</div>
            <div className="kb-divider" />
            <div>
              <h2 className="kb-title">Configurador de GMUD</h2>
              <p className="kb-subtitle">Estruturação de fluxo Kanban</p>
            </div>
          </div>
          <button onClick={onClose} className="kb-close-btn">
            &times;
          </button>
        </header>

        <nav className="kb-stepper">
          {wf.map((step, idx) => {
            const isActive = idx === activeStepIndex;
            const isCompleted = idx < activeStepIndex;
            return (
              <div
                key={step.key}
                className={`kb-step-item ${
                  isActive ? "active" : isCompleted ? "completed" : "pending"
                }`}
                onClick={() => setActiveStepIndex(idx)}
              >
                <div className="kb-step-circle">
                  {isCompleted ? "✓" : idx + 1}
                </div>
                <span className="kb-step-title-text">{step.title}</span>
              </div>
            );
          })}
        </nav>

        <main className="kb-main">
          <div className="kb-grid">
            {/* BIBLIOTECA (FILTRADA POR COLUMNKEY DO STEP ATUAL) */}
            <section className="kb-column">
              <div className="kb-column-header">
                <h4 className="kb-title" style={{ fontSize: "12px" }}>
                  Biblioteca de Cards
                </h4>
                <span className="kb-badge">{availableCount} disponíveis</span>
              </div>

              <div className="kb-scroll">
                {cardsForCurrentStep.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      marginTop: 24,
                      color: "#999",
                      fontSize: 12,
                    }}
                  >
                    Nenhum card disponível para <b>{currentStep?.title}</b>.
                  </div>
                ) : (
                  cardsForCurrentStep.map((card) => {
                    const isChecked = pickedInCurrentStep.includes(card.id);
                    return (
                      <label
                        key={card.id}
                        className="kb-card-label"
                        style={{
                          borderColor: isChecked ? "#ee0000" : "#eee",
                          backgroundColor: isChecked ? "#fdf2f2" : "#fff",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCard(currentStep.key, card.id)}
                          className="kb-checkbox"
                          style={{ accentColor: "#ee0000" }}
                        />
                        <div style={{ flex: 1 }}>
                          <div className="kb-card-title">{card.title}</div>
                          <div style={{ fontSize: "11px", color: "#888" }}>
                            {(card.subtasks || []).length} subtarefas
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </section>

            {/* ORDEM DO STEP (COM SUBTAREFAS) */}
            <section
              className="kb-column"
              style={{ backgroundColor: "#fafafa" }}
            >
              <div className="kb-column-header">
                <h4 className="kb-title" style={{ fontSize: "12px" }}>
                  Ordem no Step: {currentStep.title}
                </h4>
                <span className="kb-badge" style={{ backgroundColor: "#333" }}>
                  {pickedInCurrentStep.length}
                </span>
              </div>

              <div ref={sortableContainerRef} className="kb-scroll">
                {pickedInCurrentStep.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      marginTop: "40px",
                      color: "#999",
                    }}
                  >
                    <p>Nenhum card selecionado.</p>
                  </div>
                ) : (
                  pickedInCurrentStep.map((id) => {
                    const card = libById[id];
                    if (!card) return null;
                    return (
                      <div
                        key={card.id}
                        data-card-id={card.id}
                        className="kb-sort-card"
                      >
                        <div data-handle className="kb-drag-handle">
                          ⠿
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className="kb-card-title">{card.title}</div>

                          {/* LISTAGEM DE SUBTAREFAS ABAIXO DA TAREFA */}
                          {card.subtasks && card.subtasks.length > 0 && (
                            <div className="kb-subtasks-preview">
                              {card.subtasks.map((st, index) => (
                                <div key={index}>• {st.title}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => toggleCard(currentStep.key, card.id)}
                          className="kb-remove-btn"
                        >
                          Remover
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </main>

        <footer className="kb-footer">
          <div style={{ fontSize: "12px", color: "#999" }}>
            A ordenação reflete a prioridade no Kanban.
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <Button
              type="button"
              variant="outline"
              disabled={activeStepIndex === 0}
              onClick={() => setActiveStepIndex((v) => v - 1)}
              className="rounded-xl border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>

            {!isLastStep ? (
              <Button
                type="button"
                onClick={() => setActiveStepIndex((v) => v + 1)}
                className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                Próximo Passo
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => onSave?.(selectedByStepKey)}
                className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                <Save className="mr-2 h-4 w-4" />
                Salvar Configuração
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
