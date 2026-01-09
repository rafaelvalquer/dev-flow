// src/components/KanbanBuilderModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Sortable from "sortablejs";
import "../App.css";

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

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [selectedByStepKey, setSelectedByStepKey] = useState({});

  const sortableContainerRef = useRef(null);
  const sortableInstance = useRef(null);

  const libById = useMemo(() => {
    const o = {};
    for (const c of lib) o[c.id] = c;
    return o;
  }, [lib]);

  const currentStep = wf[activeStepIndex];

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
  const pickedInCurrentStep = selectedByStepKey[currentStep?.key] || [];

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
            {/* BIBLIOTECA */}
            <section className="kb-column">
              <div className="kb-column-header">
                <h4 className="kb-title" style={{ fontSize: "12px" }}>
                  Biblioteca de Cards
                </h4>
                <span className="kb-badge">{lib.length} disponíveis</span>
              </div>
              <div className="kb-scroll">
                {lib.map((card) => {
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
                })}
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
            <button
              disabled={activeStepIndex === 0}
              onClick={() => setActiveStepIndex((v) => v - 1)}
              className={`kb-btn kb-btn-secondary ${
                activeStepIndex === 0 ? "kb-btn-disabled" : ""
              }`}
            >
              Voltar
            </button>

            {!isLastStep ? (
              <button
                onClick={() => setActiveStepIndex((v) => v + 1)}
                className="kb-btn kb-btn-primary"
              >
                Próximo Passo
              </button>
            ) : (
              <button
                onClick={() => onSave?.(selectedByStepKey)}
                className="kb-btn kb-btn-save"
              >
                Salvar Configuração
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
