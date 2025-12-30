// src/components/RDMTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import catalogo from "../data/rdmCatalogo.json";
import pessoasDb from "../data/pessoas.json";
import { gerarRdmDocx } from "../utils/rdmDocx";
import { motion } from "framer-motion";
import { buildCronogramaAtividades } from "../utils/buildCronograma";
import { rdmCopilot } from "../lib/rdmCopilot";

/**
 * Observação:
 * - Para preencher automaticamente o TÍTULO com o resumo do Jira,
 *   passe a prop opcional `initialTitle` para este componente:
 *   <RDMTab initialTitle={jiraIssue.fields.summary} />
 */

const RDM_INITIAL = {
  // Cabeçalho
  titulo: "",
  categoria: "",
  tipo: "",
  classificacao: "",
  impactoNivel: "", // Baixo | Médio | Alto
  registroPA: "",
  chamadoCASD: "",
  mudancaReincidente: "NÃO",

  // Objetivo e justificativas
  objetivoDescricao: "",
  oQue: "",
  porQue: "",
  paraQue: "",

  // Onde e como
  ondeAmbiente: "",
  ondeServico: "",
  acao: "",
  beneficio: "",
  areasAfetadas: "",
  deAcordoResponsavel: "", // "SIM" | "NÃO"

  // Impactos
  impactoNaoExecutar: "",
  impactoAmbiente: "",

  // Alinhamentos: [{nome, area, contato}]
  alinhamentos: [{ nome: "", area: "", contato: "" }],

  // Homologação
  homologacaoRealizada: "", // "SIM" | "NÃO"

  // Solicitante / Executor
  solicitante: { nome: "", area: "", contato: "" },
  liderTecnico: { nome: "", area: "", contato: "" },
  executores: [{ nome: "", area: "", contato: "" }],

  // Parâmetros do cronograma
  inicioAtividades: "", // datetime-local (ex: 2025-12-23T18:00)
  stepMinutes: 15,
  inicioAtividadesAuto: true,

  // Janelas (listas dinâmicas)
  atividades: [{ dataHora: "", descricao: "", responsavel: "" }],
  rollbackPlan: [{ dataHora: "", descricao: "", responsavel: "" }],
};

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function findPessoaByNome(nome) {
  const hit = (pessoasDb?.pessoas || []).find(
    (p) => p.nome.toLowerCase() === String(nome || "").toLowerCase()
  );
  return hit || null;
}

function hydratePessoaByNome(nome) {
  const p = findPessoaByNome(nome);
  if (!p) return { nome: nome || "", area: "", contato: "" };
  return { nome: p.nome, area: p.area || "", contato: p.contato || "" };
}

export default function RDMTab({ initialTitle = "", initialDueDate = "" }) {
  const [rdm, setRdm] = useState(RDM_INITIAL);

  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotFiles, setCopilotFiles] = useState([]);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotErr, setCopilotErr] = useState("");
  const [copilotOverwrite, setCopilotOverwrite] = useState(true);

  async function executarCopilot() {
    setCopilotErr("");

    try {
      if (!copilotFiles.length) {
        setCopilotErr("Selecione ao menos 1 arquivo.");
        return;
      }

      setCopilotBusy(true);

      const out = await rdmCopilot({
        files: copilotFiles,
        title: rdm.titulo || "",
      });

      const a = out?.answers || {};

      setRdm((prev) => ({
        ...prev,
        objetivoDescricao: copilotOverwrite
          ? a.objetivoDescricao || ""
          : prev.objetivoDescricao || a.objetivoDescricao || "",
        oQue: copilotOverwrite ? a.oQue || "" : prev.oQue || a.oQue || "",
        porQue: copilotOverwrite
          ? a.porQue || ""
          : prev.porQue || a.porQue || "",
        paraQue: copilotOverwrite
          ? a.paraQue || ""
          : prev.paraQue || a.paraQue || "",
        beneficio: copilotOverwrite
          ? a.beneficio || ""
          : prev.beneficio || a.beneficio || "",
      }));

      setCopilotOpen(false);
      setCopilotFiles([]);
    } catch (e) {
      setCopilotErr(e?.message ? String(e.message) : String(e));
    } finally {
      setCopilotBusy(false);
    }
  }

  // ---------- (REMOVIDO) LocalStorage ----------
  // Não carrega nem salva nada no localStorage.

  // ---------- Título vindo do App/Jira ----------
  useEffect(() => {
    if (initialTitle) {
      setRdm((prev) => ({ ...prev, titulo: prev.titulo || initialTitle }));
    }
  }, [initialTitle]);

  useEffect(() => {
    if (!initialDueDate) return;

    const autoValue = buildInicioFromDueDate(initialDueDate);
    if (!autoValue) return;

    setRdm((prev) => {
      // Se o usuário já mexeu, não sobrescreve
      if (prev.inicioAtividades && prev.inicioAtividadesAuto === false)
        return prev;

      // Se está vazio OU ainda está em modo auto, atualiza
      return {
        ...prev,
        inicioAtividades: autoValue,
        inicioAtividadesAuto: true,
      };
    });
  }, [initialDueDate]);

  // ---------- Helpers ----------
  const pad = (n) => String(n).padStart(2, "0");

  const buildInicioFromDueDate = (dueYmd) => {
    const ymd = String(dueYmd || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
    return `${ymd}T18:00`;
  };

  function updInicioAtividades(value) {
    setRdm((prev) => ({
      ...prev,
      inicioAtividades: value,
      inicioAtividadesAuto: false, // usuário mexeu
    }));
  }

  function upd(field, value) {
    setRdm((prev) => ({ ...prev, [field]: value }));
  }

  function updNested(path, value) {
    setRdm((prev) => {
      const next = clone(prev);
      const parts = path.split(".");
      let ref = next;
      for (let i = 0; i < parts.length - 1; i++) ref = ref[parts[i]];
      ref[parts[parts.length - 1]] = value;
      return next;
    });
  }

  function blankFor(key) {
    if (key === "alinhamentos" || key === "executores") {
      return { nome: "", area: "", contato: "" };
    }
    if (key === "atividades" || key === "rollbackPlan") {
      return { dataHora: "", descricao: "", responsavel: "" };
    }
    return {};
  }

  function addLinha(field, emptyObj) {
    setRdm((prev) => {
      const arr = [...(prev[field] || [])];
      return { ...prev, [field]: [...arr, { ...emptyObj }] };
    });
  }

  function rmLinha(listKey, idx) {
    setRdm((prev) => {
      const arr = [...(prev[listKey] || [])];
      arr.splice(idx, 1);
      return {
        ...prev,
        [listKey]: arr.length ? arr : [clone(blankFor(listKey))],
      };
    });
  }

  function onPickPessoa(pathBase, nome) {
    const p = hydratePessoaByNome(nome);
    setRdm((prev) => {
      const next = clone(prev);
      const parts = pathBase.split(".");
      let ref = next;
      for (let i = 0; i < parts.length; i++) ref = ref[parts[i]];
      ref.nome = p.nome;
      ref.area = p.area;
      ref.contato = p.contato;
      return next;
    });
  }

  // ---------- Catálogo ----------
  const {
    categorias = [],
    tipos = [],
    classificacoes = [],
    impactos = [],
    ambientes = [],
    servicos = [],
  } = catalogo || {};

  const nomesPessoas = useMemo(
    () => (pessoasDb?.pessoas || []).map((p) => p.nome),
    []
  );

  // ---------- Cronograma (preview) ----------
  const STEP_MIN = Number(rdm?.stepMinutes ?? 15);

  const cron = useMemo(() => {
    return buildCronogramaAtividades({
      rdm,
      STEP_MIN,
      NOME_PADRAO: "Suporte Infra Call Center",
    });
  }, [rdm, STEP_MIN]);

  const totalH = Math.floor((cron?.totalMin || 0) / 60);
  const totalM = (cron?.totalMin || 0) % 60;

  const cronGroups = useMemo(() => {
    const blocks = cron?.blocks || {};
    return {
      Antes: blocks.seqBefore || [],
      "Atividades (dinâmicas)": blocks.seqDynamic || [],
      "Validação técnica": blocks.seqValidTec || [],
      "Validação funcional": blocks.seqValidFunc || [],
      Depois: blocks.seqAfter || [],
    };
  }, [cron]);

  const renderCronList = (arr) =>
    !arr.length ? (
      <div style={{ padding: "6px 0", color: "#777" }}>Nenhum item.</div>
    ) : (
      <ul style={{ margin: "6px 0 8px 18px" }}>
        {arr.map((it, i) => (
          <li key={`${it.bloco || "all"}-${i}`}>
            {it.horaFmt} – {it.descricao || "(sem descrição)"}{" "}
            {it.noDuration ? " (sem duração)" : ""}
          </li>
        ))}
      </ul>
    );

  return (
    <motion.section
      key="rdm"
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
      className="rdm-wrap"
    >
      {/* ===== 1. IDENTIFICAÇÃO DA RDM ===== */}
      <div className="section-header">
        <i className="fas fa-id-card"></i>
        <h2>Identificação da RDM</h2>
      </div>

      <div className="rdm-grid">
        <div className="rdm-card span-2 highlight">
          <label>
            TÍTULO DA RDM <span className="required">*</span>
          </label>
          <input
            value={rdm.titulo ?? ""}
            onChange={(e) => upd("titulo", e.target.value)}
            placeholder="Ex: Implantação de nova regra de cobrança automática em URA"
          />
        </div>

        <div className="rdm-card">
          <label>CATEGORIA</label>
          <input
            list="lista-categorias"
            value={rdm.categoria ?? ""}
            onChange={(e) => upd("categoria", e.target.value)}
            placeholder="Selecione ou digite"
          />
          <datalist id="lista-categorias">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="rdm-card">
          <label>TIPO</label>
          <input
            list="lista-tipos"
            value={rdm.tipo ?? ""}
            onChange={(e) => upd("tipo", e.target.value)}
            placeholder="Selecione ou digite"
          />
          <datalist id="lista-tipos">
            {tipos.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div className="rdm-card">
          <label>CLASSIFICAÇÃO</label>
          <input
            list="lista-classificacoes"
            value={rdm.classificacao ?? ""}
            onChange={(e) => upd("classificacao", e.target.value)}
            placeholder="Selecione ou digite"
          />
          <datalist id="lista-classificacoes">
            {classificacoes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="rdm-card critical">
          <label>
            IMPACTO <span className="required">*</span>
          </label>
          <select
            value={rdm.impactoNivel ?? ""}
            onChange={(e) => upd("impactoNivel", e.target.value)}
          >
            <option value="">Selecione</option>
            <option value="Baixo">Baixo</option>
            <option value="Médio">Médio</option>
            <option value="Alto">Alto</option>
          </select>
        </div>
      </div>

      {/* ===== 2. JUSTIFICATIVA E OBJETIVO ===== */}
      <div className="section-header">
        <i className="fas fa-lightbulb"></i>
        <h2>Justificativa e Objetivo</h2>
      </div>

      <div className="rdm-grid">
        <div className="rdm-card span-2">
          <label>Descrição do Objetivo</label>
          <textarea
            value={rdm.objetivoDescricao ?? ""}
            onChange={(e) => upd("objetivoDescricao", e.target.value)}
            placeholder="Qual o objetivo principal desta mudança?"
          />
        </div>

        <div className="rdm-card span-2">
          <label>
            O que vai fazer? <span className="required">*</span>
          </label>
          <textarea
            value={rdm.oQue ?? ""}
            onChange={(e) => upd("oQue", e.target.value)}
            placeholder="Descreva claramente a atividade / escopo da mudança"
          />
        </div>

        <div className="rdm-card">
          <label>
            Por quê? (Motivo) <span className="required">*</span>
          </label>
          <textarea
            value={rdm.porQue ?? ""}
            onChange={(e) => upd("porQue", e.target.value)}
            placeholder="Motivação da mudança"
          />
        </div>

        <div className="rdm-card">
          <label>
            Para que? (Efeito desejado) <span className="required">*</span>
          </label>
          <textarea
            value={rdm.paraQue ?? ""}
            onChange={(e) => upd("paraQue", e.target.value)}
            placeholder="Resultados esperados / benefício"
          />
        </div>

        <div className="rdm-card span-2">
          <label>Benefício da Atividade</label>
          <textarea
            value={rdm.beneficio ?? ""}
            onChange={(e) => upd("beneficio", e.target.value)}
            placeholder="Benefícios e ganhos esperados"
          />
        </div>
      </div>

      {/* ===== 3. EXECUÇÃO E ESCOPO ===== */}
      <div className="section-header">
        <i className="fas fa-tools"></i>
        <h2>Execução e Escopo</h2>
      </div>

      <div className="rdm-grid">
        <div className="rdm-card">
          <label>Onde? — Ambiente</label>
          <input
            list="lista-ambientes"
            value={rdm.ondeAmbiente ?? ""}
            onChange={(e) => upd("ondeAmbiente", e.target.value)}
            placeholder="Selecione ou digite"
          />
          <datalist id="lista-ambientes">
            {ambientes.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>

        <div className="rdm-card">
          <label>Onde? — Serviço (Negócio)</label>
          <input
            list="lista-servicos"
            value={rdm.ondeServico ?? ""}
            onChange={(e) => upd("ondeServico", e.target.value)}
            placeholder="Selecione ou digite"
          />
          <datalist id="lista-servicos">
            {servicos.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        <div className="rdm-card span-2">
          <label>Como será feito? (Ação)</label>
          <textarea
            value={rdm.acao ?? ""}
            onChange={(e) => upd("acao", e.target.value)}
            placeholder="Passos de alto nível da execução"
          />
        </div>

        <div className="rdm-card span-2">
          <label>Áreas Usuárias Afetadas pela Mudança</label>
          <textarea
            value={rdm.areasAfetadas ?? ""}
            onChange={(e) => upd("areasAfetadas", e.target.value)}
            placeholder="Ex.: Atendimento, Cobrança, Financeiro..."
          />
        </div>

        <div className="rdm-card">
          <label>Já possui o “de acordo” do responsável?</label>
          <select
            value={rdm.deAcordoResponsavel ?? ""}
            onChange={(e) => upd("deAcordoResponsavel", e.target.value)}
          >
            <option value=""></option>
            <option value="SIM">SIM</option>
            <option value="NÃO">NÃO</option>
          </select>
        </div>

        <div className="rdm-card">
          <label>Foi realizada a homologação do item?</label>
          <select
            value={rdm.homologacaoRealizada ?? ""}
            onChange={(e) => upd("homologacaoRealizada", e.target.value)}
          >
            <option value=""></option>
            <option value="SIM">SIM</option>
            <option value="NÃO">NÃO</option>
          </select>
        </div>
      </div>

      {/* ===== 4. RISCOS E IMPACTOS ===== */}
      <div className="section-header critical">
        <i className="fas fa-exclamation-triangle"></i>
        <h2>Riscos e Impactos</h2>
      </div>

      <div className="rdm-grid">
        <div className="rdm-card span-2">
          <label>Qual o impacto caso a RDM NÃO seja executada?</label>
          <textarea
            value={rdm.impactoNaoExecutar ?? ""}
            onChange={(e) => upd("impactoNaoExecutar", e.target.value)}
            placeholder="Consequências para o negócio ou operação"
          />
        </div>

        <div className="rdm-card span-2">
          <label>Qual o impacto no ambiente ao executar a RDM?</label>
          <textarea
            value={rdm.impactoAmbiente ?? ""}
            onChange={(e) => upd("impactoAmbiente", e.target.value)}
            placeholder="Indisponibilidade, degradação, janela de manutenção..."
          />
        </div>
      </div>

      {/* ===== 5. ALINHAMENTOS E RESPONSÁVEIS ===== */}
      <div className="section-header">
        <i className="fas fa-users"></i>
        <h2>Alinhamentos e Responsáveis</h2>
      </div>

      <div className="rdm-grid">
        <div className="rdm-card span-2">
          <label>Responsável (Técnica e Negócio)</label>

          {rdm.alinhamentos.map((row, idx) => (
            <div key={`alin-${idx}`} className="table-row">
              <input
                list="lista-pessoas"
                placeholder="Responsável"
                value={row.nome ?? ""}
                onChange={(e) =>
                  onPickPessoa(`alinhamentos.${idx}`, e.target.value)
                }
              />
              <input
                placeholder="Área"
                value={row.area ?? ""}
                onChange={(e) =>
                  updNested(`alinhamentos.${idx}.area`, e.target.value)
                }
              />
              <input
                placeholder="Contato"
                value={row.contato ?? ""}
                onChange={(e) =>
                  updNested(`alinhamentos.${idx}.contato`, e.target.value)
                }
              />
              <button
                type="button"
                onClick={() => rmLinha("alinhamentos", idx)}
              >
                X
              </button>
            </div>
          ))}

          <button
            type="button"
            className="primary small"
            onClick={() =>
              addLinha("alinhamentos", { nome: "", area: "", contato: "" })
            }
          >
            + Adicionar alinhamento
          </button>
        </div>

        <div className="rdm-card span-2">
          <label>LÍDER TÉCNICO</label>
          <div className="table-row">
            <input
              list="lista-pessoas"
              placeholder="Nome"
              value={rdm.liderTecnico.nome ?? ""}
              onChange={(e) => onPickPessoa("liderTecnico", e.target.value)}
            />
            <input
              placeholder="Área"
              value={rdm.liderTecnico.area ?? ""}
              onChange={(e) => updNested("liderTecnico.area", e.target.value)}
            />
            <input
              placeholder="Contato"
              value={rdm.liderTecnico.contato ?? ""}
              onChange={(e) =>
                updNested("liderTecnico.contato", e.target.value)
              }
            />
          </div>
        </div>

        <div className="rdm-card span-2">
          <label>EXECUTORES</label>

          {rdm.executores.map((ex, idx) => (
            <div key={`exec-${idx}`} className="table-row">
              <input
                list="lista-pessoas"
                placeholder="Nome"
                value={ex.nome ?? ""}
                onChange={(e) =>
                  onPickPessoa(`executores.${idx}`, e.target.value)
                }
              />
              <input
                placeholder="Área"
                value={ex.area ?? ""}
                onChange={(e) =>
                  updNested(`executores.${idx}.area`, e.target.value)
                }
              />
              <input
                placeholder="Contato"
                value={ex.contato ?? ""}
                onChange={(e) =>
                  updNested(`executores.${idx}.contato`, e.target.value)
                }
              />
              <button type="button" onClick={() => rmLinha("executores", idx)}>
                X
              </button>
            </div>
          ))}

          <button
            type="button"
            className="primary small"
            onClick={() =>
              addLinha("executores", { nome: "", area: "", contato: "" })
            }
          >
            + Adicionar executor
          </button>
        </div>

        {/* ===== CRONOGRAMA ===== */}
        <div className="rdm-card span-2">
          <label>Início das atividades</label>
          <input
            type="datetime-local"
            value={rdm.inicioAtividades ?? ""}
            onChange={(e) => updInicioAtividades(e.target.value)}
          />

          <label style={{ marginTop: 8 }}>Intervalo (min)</label>
          <input
            type="number"
            min={5}
            step={5}
            value={rdm.stepMinutes ?? 15}
            onChange={(e) => upd("stepMinutes", Number(e.target.value || 15))}
            style={{ width: 120 }}
          />
        </div>

        <div className="rdm-card span-2">
          <label>DESCRIÇÃO DETALHADA DA ATIVIDADE</label>

          {rdm.atividades.map((row, idx) => (
            <div key={`atv-${idx}`} className="table-row wide">
              <textarea
                placeholder="Descrição detalhada da atividade *"
                value={row.descricao ?? ""}
                onChange={(e) =>
                  updNested(`atividades.${idx}.descricao`, e.target.value)
                }
              />
              <input
                list="lista-pessoas"
                placeholder="Responsável"
                value={row.responsavel ?? ""}
                onChange={(e) =>
                  updNested(`atividades.${idx}.responsavel`, e.target.value)
                }
              />
              <button type="button" onClick={() => rmLinha("atividades", idx)}>
                X
              </button>
            </div>
          ))}

          <button
            type="button"
            className="primary small"
            onClick={() =>
              addLinha("atividades", {
                dataHora: "",
                descricao: "",
                responsavel: "",
              })
            }
          >
            + Adicionar atividade
          </button>

          <div
            style={{
              marginTop: 12,
              background: "#fafafa",
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 8,
            }}
          >
            <strong>Cronograma (pré-visualização):</strong>

            {!rdm.inicioAtividades ? (
              <div style={{ padding: "6px 0", color: "#777" }}>
                Informe o “Início das atividades” para visualizar o cronograma.
              </div>
            ) : (
              <>
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {Object.entries(cronGroups).map(([title, arr], idx) => (
                    <details key={title} open={idx === 0}>
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                        {title} ({arr.length})
                      </summary>
                      {renderCronList(arr)}
                    </details>
                  ))}
                </div>

                <div style={{ marginTop: 8 }}>
                  <b>Tempo total:</b> {totalH}:{pad(totalM)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== 7. PLANO DE ROLLBACK ===== */}
      <div className="section-header">
        <i className="fas fa-undo-alt"></i>
        <h2>Plano de Rollback</h2>
      </div>

      <div className="rdm-grid">
        <div className="rdm-card span-2">
          {rdm.rollbackPlan.map((row, idx) => (
            <div key={`rb-${idx}`} className="table-row wide">
              <textarea
                placeholder="Descrição detalhada do passo de rollback *"
                value={row.descricao ?? ""}
                onChange={(e) =>
                  updNested(`rollbackPlan.${idx}.descricao`, e.target.value)
                }
              />
              <input
                list="lista-pessoas"
                placeholder="Responsável"
                value={row.responsavel ?? ""}
                onChange={(e) =>
                  updNested(`rollbackPlan.${idx}.responsavel`, e.target.value)
                }
              />
              <button
                type="button"
                onClick={() => rmLinha("rollbackPlan", idx)}
              >
                X
              </button>
            </div>
          ))}

          <button
            type="button"
            className="primary small"
            onClick={() =>
              addLinha("rollbackPlan", {
                dataHora: "",
                descricao: "",
                responsavel: "",
              })
            }
          >
            + Adicionar passo de rollback
          </button>
        </div>
      </div>

      {/* ===== AÇÕES FINAIS FIXAS ===== */}
      <div className="rdm-actions fixed">
        <button className="primary large" onClick={() => gerarRdmDocx(rdm)}>
          <i className="fas fa-file-word"></i> Gerar Documento Word (.docx)
        </button>

        <button
          className="primary"
          type="button"
          onClick={() => {
            setCopilotErr("");
            setCopilotOpen(true);
          }}
        >
          <i className="fas fa-robot"></i> Co-pilot
        </button>

        <button className="primary pdf" onClick={() => window.print()}>
          <i className="fas fa-print"></i> Imprimir / Gerar PDF
        </button>
      </div>

      <datalist id="lista-pessoas">
        {nomesPessoas.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {copilotOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => !copilotBusy && setCopilotOpen(false)}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, flex: 1 }}>
                Co-pilot (Gemini) — preencher RDM
              </h3>
              <button
                type="button"
                onClick={() => !copilotBusy && setCopilotOpen(false)}
              >
                X
              </button>
            </div>

            <p style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
              Anexe arquivos (PDF, imagens, textos) com contexto técnico. O
              Co-pilot retornará um JSON e preencherá: Objetivo, O que, Por quê,
              Para que, Benefício.
            </p>

            <input
              type="file"
              multiple
              onChange={(e) =>
                setCopilotFiles(Array.from(e.target.files || []))
              }
              disabled={copilotBusy}
              accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.docx"
            />

            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={copilotOverwrite}
                  onChange={(e) => setCopilotOverwrite(e.target.checked)}
                  disabled={copilotBusy}
                />
                Substituir campos existentes
              </label>
            </div>

            {!!copilotFiles.length && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#333" }}>
                <b>Arquivos:</b>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {copilotFiles.map((f) => (
                    <li key={f.name + f.size}>{f.name}</li>
                  ))}
                </ul>
              </div>
            )}

            {copilotErr && (
              <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>
                {copilotErr}
              </div>
            )}

            <div
              style={{
                marginTop: 14,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (copilotBusy) return;
                  setCopilotFiles([]);
                  setCopilotErr("");
                }}
                disabled={copilotBusy}
              >
                Limpar
              </button>

              <button
                type="button"
                className="primary"
                onClick={executarCopilot}
                disabled={copilotBusy}
              >
                {copilotBusy ? "Processando..." : "Executar Co-pilot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
}
