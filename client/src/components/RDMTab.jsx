// src/components/RDMTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import { RDM_KEY } from "../utils/gmudUtils";
import catalogo from "../data/rdmCatalogo.json";
import pessoasDb from "../data/pessoas.json";

/**
 * Observação:
 * - Para preencher automaticamente o TÍTULO com o resumo do Jira,
 *   passe a prop opcional `jiraTitle` para este componente:
 *   <RDMTab jiraTitle={jiraIssue.fields.summary} />
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

export default function RDMTab({ initialTitle = "" }) {
  const [rdm, setRdm] = useState(RDM_INITIAL);

  // Carrega do storage
  useEffect(() => {
    const raw = localStorage.getItem(RDM_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setRdm({ ...clone(RDM_INITIAL), ...parsed });
      } catch {}
    }
  }, []);

  // Persiste no storage
  useEffect(() => {
    localStorage.setItem(RDM_KEY, JSON.stringify(rdm));
  }, [rdm]);

  // NOVO: quando chegar um título do App (sincronizado do Jira), aplica no campo
  useEffect(() => {
    if (initialTitle) {
      setRdm((prev) => ({ ...prev, titulo: initialTitle }));
    }
  }, [initialTitle]);

  function upd(field, value) {
    setRdm((prev) => ({ ...prev, [field]: value }));
  }

  function updNested(path, value) {
    setRdm((prev) => {
      const next = clone(prev);
      // path tipo "solicitante.nome" ou "atividades.0.descricao"
      const parts = path.split(".");
      let ref = next;
      for (let i = 0; i < parts.length - 1; i++) ref = ref[parts[i]];
      ref[parts[parts.length - 1]] = value;
      return next;
    });
  }

  function salvarRdmLocal() {
    localStorage.setItem(RDM_KEY, JSON.stringify(rdm));
    alert("RDM salva localmente.");
  }

  // Helpers de linhas dinâmicas
  function addLinha(listKey, blank) {
    setRdm((prev) => ({
      ...prev,
      [listKey]: [...prev[listKey], clone(blank)],
    }));
  }
  function rmLinha(listKey, idx) {
    setRdm((prev) => {
      const arr = [...prev[listKey]];
      arr.splice(idx, 1);
      return { ...prev, [listKey]: arr.length ? arr : [clone(arr[0] ?? {})] };
    });
  }

  // Quando selecionar nomes nos autocompletes, completar área/contato
  function onPickPessoa(pathBase, nome) {
    const p = hydratePessoaByNome(nome);
    setRdm((prev) => {
      const next = clone(prev);
      const parts = pathBase.split("."); // ex: "solicitante"   | "executores.0" | "alinhamentos.2"
      let ref = next;
      for (let i = 0; i < parts.length; i++) {
        ref = ref[parts[i]];
      }
      ref.nome = p.nome;
      ref.area = p.area;
      ref.contato = p.contato;
      return next;
    });
  }

  // (Sugestões) — listas do catálogo
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

  return (
    <section className="rdm-wrap">
      <div className="rdm-grid">
        {/* CABEÇALHO */}
        <div className="rdm-card span-2">
          <label>TÍTULO DA RDM</label>
          <input
            value={rdm.titulo}
            onChange={(e) => upd("titulo", e.target.value)}
            placeholder="Resumo da mudança (pode ser ajustado)"
          />
        </div>

        <div className="rdm-card">
          <label>CATEGORIA</label>
          <input
            list="lista-categorias"
            value={rdm.categoria}
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
            value={rdm.tipo}
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
            value={rdm.classificacao}
            onChange={(e) => upd("classificacao", e.target.value)}
            placeholder="Selecione ou digite"
          />
          <datalist id="lista-classificacoes">
            {classificacoes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="rdm-card">
          <label>IMPACTO</label>
          <input
            list="lista-impactos"
            value={rdm.impactoNivel}
            onChange={(e) => upd("impactoNivel", e.target.value)}
            placeholder="Baixo, Médio ou Alto"
          />
          <datalist id="lista-impactos">
            {impactos.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
        </div>

        {/* OBJETIVO / JUSTIFICATIVA */}
        <div className="rdm-card span-2">
          <label>Descrição Objetivo</label>
          <textarea
            value={rdm.objetivoDescricao}
            onChange={(e) => upd("objetivoDescricao", e.target.value)}
            placeholder="Qual o objetivo principal desta mudança?"
          />
        </div>

        <div className="rdm-card span-2">
          <label>O que vai fazer?</label>
          <textarea
            value={rdm.oQue}
            onChange={(e) => upd("oQue", e.target.value)}
            placeholder="Descreva claramente a atividade / escopo"
          />
        </div>

        <div className="rdm-card">
          <label>Por quê? (Motivo)</label>
          <textarea
            value={rdm.porQue}
            onChange={(e) => upd("porQue", e.target.value)}
            placeholder="Motivação da mudança"
          />
        </div>

        <div className="rdm-card">
          <label>Para que? (Qual o efeito desejado)</label>
          <textarea
            value={rdm.paraQue}
            onChange={(e) => upd("paraQue", e.target.value)}
            placeholder="Resultados esperados"
          />
        </div>

        {/* ONDE e COMO */}
        <div className="rdm-card">
          <label>Onde? — Ambiente</label>
          <input
            list="lista-ambientes"
            value={rdm.ondeAmbiente}
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
            value={rdm.ondeServico}
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
            value={rdm.acao}
            onChange={(e) => upd("acao", e.target.value)}
            placeholder="Passos de alto nível da execução"
          />
        </div>

        <div className="rdm-card">
          <label>Benefício da Atividade</label>
          <textarea
            value={rdm.beneficio}
            onChange={(e) => upd("beneficio", e.target.value)}
            placeholder="Benefícios/ganhos esperados"
          />
        </div>

        <div className="rdm-card">
          <label>ÁREAS USUÁRIAS AFETADAS PELA MUDANÇA</label>
          <textarea
            value={rdm.areasAfetadas}
            onChange={(e) => upd("areasAfetadas", e.target.value)}
            placeholder="Ex.: Atendimento, Cobrança..."
          />
        </div>

        <div className="rdm-card">
          <label>Já possui o “de acordo” do responsável?</label>
          <select
            value={rdm.deAcordoResponsavel}
            onChange={(e) => upd("deAcordoResponsavel", e.target.value)}
          >
            <option value=""></option>
            <option value="SIM">SIM</option>
            <option value="NÃO">NÃO</option>
          </select>
        </div>

        {/* IMPACTOS */}
        <div className="rdm-card span-2">
          <label>QUAL O IMPACTO CASO A RDM NÃO SEJA EXECUTADA?</label>
          <textarea
            value={rdm.impactoNaoExecutar}
            onChange={(e) => upd("impactoNaoExecutar", e.target.value)}
          />
        </div>

        <div className="rdm-card span-2">
          <label>QUAL O IMPACTO NO AMBIENTE AO EXECUTAR A RDM?</label>
          <textarea
            value={rdm.impactoAmbiente}
            onChange={(e) => upd("impactoAmbiente", e.target.value)}
          />
        </div>

        {/* ALINHAMENTOS */}
        <div className="rdm-card span-2">
          <label>ALINHAMENTOS (Técnica e Negócio)</label>

          {rdm.alinhamentos.map((row, idx) => (
            <div
              key={`alin-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr auto",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <input
                list="lista-pessoas"
                placeholder="Responsável"
                value={row.nome}
                onChange={(e) =>
                  onPickPessoa(`alinhamentos.${idx}`, e.target.value)
                }
              />
              <input
                placeholder="Área"
                value={row.area}
                onChange={(e) =>
                  updNested(`alinhamentos.${idx}.area`, e.target.value)
                }
              />
              <input
                placeholder="Contato"
                value={row.contato}
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
            className="primary"
            onClick={() =>
              addLinha("alinhamentos", { nome: "", area: "", contato: "" })
            }
          >
            + Adicionar alinhamento
          </button>
        </div>

        <datalist id="lista-pessoas">
          {nomesPessoas.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        {/* HOMOLOGAÇÃO */}
        <div className="rdm-card">
          <label>Foi realizada a homologação do item?</label>
          <select
            value={rdm.homologacaoRealizada}
            onChange={(e) => upd("homologacaoRealizada", e.target.value)}
          >
            <option value=""></option>
            <option value="SIM">SIM</option>
            <option value="NÃO">NÃO</option>
          </select>
        </div>

        {/* SOLICITANTE / EXECUTOR */}
        <div className="rdm-card span-2">
          <label>SOLICITANTE</label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 1fr",
              gap: 8,
            }}
          >
            <input
              list="lista-pessoas"
              placeholder="Nome"
              value={rdm.solicitante.nome}
              onChange={(e) => onPickPessoa("solicitante", e.target.value)}
            />
            <input
              placeholder="Área"
              value={rdm.solicitante.area}
              onChange={(e) => updNested("solicitante.area", e.target.value)}
            />
            <input
              placeholder="Contato"
              value={rdm.solicitante.contato}
              onChange={(e) => updNested("solicitante.contato", e.target.value)}
            />
          </div>
        </div>

        <div className="rdm-card span-2">
          <label>LÍDER TÉCNICO</label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 1fr",
              gap: 8,
            }}
          >
            <input
              list="lista-pessoas"
              placeholder="Nome"
              value={rdm.liderTecnico.nome}
              onChange={(e) => onPickPessoa("liderTecnico", e.target.value)}
            />
            <input
              placeholder="Área"
              value={rdm.liderTecnico.area}
              onChange={(e) => updNested("liderTecnico.area", e.target.value)}
            />
            <input
              placeholder="Contato"
              value={rdm.liderTecnico.contato}
              onChange={(e) =>
                updNested("liderTecnico.contato", e.target.value)
              }
            />
          </div>
        </div>

        <div className="rdm-card span-2">
          <label>EXECUTORES</label>
          {rdm.executores.map((ex, idx) => (
            <div
              key={`exec-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr auto",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <input
                list="lista-pessoas"
                placeholder="Nome"
                value={ex.nome}
                onChange={(e) =>
                  onPickPessoa(`executores.${idx}`, e.target.value)
                }
              />
              <input
                placeholder="Área"
                value={ex.area}
                onChange={(e) =>
                  updNested(`executores.${idx}.area`, e.target.value)
                }
              />
              <input
                placeholder="Contato"
                value={ex.contato}
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
            className="primary"
            onClick={() =>
              addLinha("executores", { nome: "", area: "", contato: "" })
            }
          >
            + Adicionar executor
          </button>
        </div>

        {/* DESCRIÇÃO DETALHADA DA ATIVIDADE */}
        <div className="rdm-card span-2">
          <label>DESCRIÇÃO DETALHADA DA ATIVIDADE</label>
          {rdm.atividades.map((row, idx) => (
            <div
              key={`atv-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "220px 1fr 260px auto",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <input
                type="datetime-local"
                value={row.dataHora}
                onChange={(e) =>
                  updNested(`atividades.${idx}.dataHora`, e.target.value)
                }
              />
              <input
                placeholder="DESCRIÇÃO DETALHADA DA ATIVIDADE *"
                value={row.descricao}
                onChange={(e) =>
                  updNested(`atividades.${idx}.descricao`, e.target.value)
                }
              />
              <input
                list="lista-pessoas"
                placeholder="RESPONSÁVEL"
                value={row.responsavel}
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
            className="primary"
            onClick={() =>
              addLinha("atividades", {
                dataHora: "",
                descricao: "",
                responsavel: "",
              })
            }
          >
            + Adicionar linha
          </button>
        </div>

        {/* JANELA DE ROLLBACK */}
        <div className="rdm-card span-2">
          <label>JANELA DE ROLLBACK</label>
          {rdm.rollbackPlan.map((row, idx) => (
            <div
              key={`rb-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "220px 1fr 260px auto",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <input
                type="datetime-local"
                value={row.dataHora}
                onChange={(e) =>
                  updNested(`rollbackPlan.${idx}.dataHora`, e.target.value)
                }
              />
              <input
                placeholder="DESCRIÇÃO DETALHADA DO ROLLBACK *"
                value={row.descricao}
                onChange={(e) =>
                  updNested(`rollbackPlan.${idx}.descricao`, e.target.value)
                }
              />
              <input
                list="lista-pessoas"
                placeholder="RESPONSÁVEL"
                value={row.responsavel}
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
            className="primary"
            onClick={() =>
              addLinha("rollbackPlan", {
                dataHora: "",
                descricao: "",
                responsavel: "",
              })
            }
          >
            + Adicionar linha
          </button>
        </div>
      </div>

      <div className="rdm-actions">
        <button className="primary" onClick={salvarRdmLocal}>
          Salvar RDM (local)
        </button>
        <button className="primary pdf" onClick={() => window.print()}>
          Gerar PDF
        </button>
      </div>
    </section>
  );
}
