// src/utils/rdmDocx.js
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ---------------------- download / template ----------------------
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadTemplateArrayBuffer(templateUrl) {
  const res = await fetch(templateUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Falha ao carregar template: ${templateUrl} (HTTP ${res.status})`
    );
  }
  return await res.arrayBuffer();
}

// ---------------------- date/time helpers (LOCAL, sem "Z") ----------------------
const pad = (n) => String(n).padStart(2, "0");

// Converte Date -> "YYYY-MM-DDTHH:mm" (LOCAL)
const toLocalIsoMinute = (d) => {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
};

// Parse seguro (aceita "YYYY-MM-DDTHH:mm" e ISO com Z)
const parseToDate = (iso) => {
  if (!iso) return null;

  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) return d;

  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;

  const [, yy, mo, dd, hh, mm] = m;
  const out = new Date(+yy, +mo - 1, +dd, +hh, +mm, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
};

const fmtDate = (isoOrDate) => {
  if (!isoOrDate) return "";
  const d = isoOrDate instanceof Date ? isoOrDate : parseToDate(isoOrDate);
  if (!d) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const fmtTime = (isoOrDate) => {
  if (!isoOrDate) return "";
  const d = isoOrDate instanceof Date ? isoOrDate : parseToDate(isoOrDate);
  if (!d) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDateTime = (isoOrDate) => {
  if (!isoOrDate) return "";
  const d = isoOrDate instanceof Date ? isoOrDate : parseToDate(isoOrDate);
  if (!d) return "";
  return `${fmtDate(d)} ${fmtTime(d)}`;
};

// ✅ Mesmo valor, mas SEM espaço (útil se sua tabela do DOCX já tem separador)
const fmtDateTimeNoSpace = (isoOrDate) => {
  if (!isoOrDate) return "";
  const d = isoOrDate instanceof Date ? isoOrDate : parseToDate(isoOrDate);
  if (!d) return "";
  return `${fmtDate(d)} ${fmtTime(d)}`; // mantive com espaço; pode trocar se quiser
};

const normalizeStep = (value, fallback = 15) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.round(n);
};

const addMinutesLocalIso = (iso, min) => {
  const d = parseToDate(iso);
  if (!d) return "";
  d.setMinutes(d.getMinutes() + min);
  return toLocalIsoMinute(d);
};

// ✅ Monta sequência com horários; SEMPRE consome step
function scheduleWithStep(inicioIso, stepMin, items) {
  const step = normalizeStep(stepMin, 15);
  if (!inicioIso) return [];

  let cursor = parseToDate(inicioIso);
  if (!cursor) return [];

  return (items || []).map((it) => {
    const start = new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + step);

    const startIso = toLocalIsoMinute(start);

    return {
      ...(it || {}),
      dataHora: startIso, // ISO local (YYYY-MM-DDTHH:mm)
      dataFmt: fmtDate(start), // ✅ "DD/MM/YYYY"
      horaFmt: fmtTime(start), // "HH:mm"
      dataHoraFmt: fmtDateTime(start), // ✅ "DD/MM/YYYY HH:mm"
      // se quiser um campo só "dataHoraTabela", use esse:
      dataHoraTabela: fmtDateTimeNoSpace(start),
    };
  });
}

function nextStartAfter(seq, currentStart, stepMin) {
  const step = normalizeStep(stepMin, 15);
  if (!seq || !seq.length) return currentStart;
  const last = seq[seq.length - 1];
  return addMinutesLocalIso(last.dataHora, step);
}

const NOME_PADRAO = "Suporte Infra Call Center";

// ---------------------- Blocos padrão ----------------------
const PADRAO_BEFORE = [
  {
    descricao:
      "Comunicar COTI (coti@claro.com.br) e GMUD (gerencia.mudancas@claro.com.br) o início da RDM",
    responsavel: NOME_PADRAO,
  },
  {
    descricao:
      "Enviar e-mail comunicando o início da Atividade para os destinatários: LAUDEJOR laudejor.coutinho@terceiros.net.com.br; Suporte InfraCC Suporte.InfraCC@claro.com.br; Gerencia de Mudanças CLARO Gerencia.Mudancas@claro.com.br; Gerencia Mudanças TI Gerencia.Net@net.com.br; COTI/OSS NET coti@netservicos.com.br",
    responsavel: NOME_PADRAO,
  },
];

const PADRAO_VALID_TEC = [
  {
    descricao:
      "Validar que fluxos atualizados estejam nos destinos corretos das pastas de PRD.",
    responsavel: NOME_PADRAO,
  },
];

const PADRAO_VALID_FUNC = [
  {
    descricao:
      "Realizar chamadas para URA com um telefone que esteja dentro do mailing do projeto, para validar transferência centralizada na nova célula de atendimento.",
    responsavel: NOME_PADRAO,
  },
];

const PADRAO_AFTER = [
  {
    descricao:
      "Comunicar COTI (coti@claro.com.br) e GMUD (gerencia.mudancas@claro.com.br) o término da RDM",
    responsavel: NOME_PADRAO,
  },
];

// ---------------------- Rollback ----------------------
const ROLLBACK_BEFORE = [
  {
    descricao:
      "Comunicar COTI (coti@claro.com.br) e GMUD (gerencia.mudancas@claro.com.br) o início do RollBack",
    responsavel: NOME_PADRAO,
  },
];

const ROLLBACK_VALID_TEC = [
  {
    descricao:
      "Validar que a aplicação de URA foi carregada com sucesso em produção",
    responsavel: NOME_PADRAO,
  },
];

const ROLLBACK_VALID_FUNC = [
  {
    descricao:
      "Realizar chamadas para URA identificar o ajuste realizado em desenvolvimento",
    responsavel: NOME_PADRAO,
  },
];

const ROLLBACK_AFTER = [
  {
    descricao:
      "Comunicar COTI (coti@claro.com.br) e GMUD (gerencia.mudancas@claro.com.br) o término do RollBack",
    responsavel: NOME_PADRAO,
  },
];

// ---------------------- main ----------------------
export async function gerarRdmDocx(rdm, opts = {}) {
  const templateUrl = opts.templateUrl ?? "/templates/Modelo-RDM.docx";
  const STEP_MIN = normalizeStep(opts.stepMinutes ?? rdm?.stepMinutes, 15);

  // ---------------- ATIVIDADES ----------------
  const inicioAtv = rdm?.inicioAtividades || "";

  const dinamicos = (rdm?.atividades || [])
    .filter((a) => a && (a.descricao || a.responsavel))
    .map((a) => ({
      descricao: a.descricao || "",
      responsavel: a.responsavel || NOME_PADRAO,
    }));

  let cursor = inicioAtv;

  const seqBefore = scheduleWithStep(cursor, STEP_MIN, PADRAO_BEFORE);
  cursor = nextStartAfter(seqBefore, cursor, STEP_MIN);

  const seqDynamic = scheduleWithStep(cursor, STEP_MIN, dinamicos);
  cursor = nextStartAfter(seqDynamic, cursor, STEP_MIN);

  const seqValidTec = scheduleWithStep(cursor, STEP_MIN, PADRAO_VALID_TEC);
  cursor = nextStartAfter(seqValidTec, cursor, STEP_MIN);

  const seqValidFunc = scheduleWithStep(cursor, STEP_MIN, PADRAO_VALID_FUNC);
  cursor = nextStartAfter(seqValidFunc, cursor, STEP_MIN);

  const seqAfter = scheduleWithStep(cursor, STEP_MIN, PADRAO_AFTER);

  const atividadesSeq = [
    ...seqBefore,
    ...seqDynamic,
    ...seqValidTec,
    ...seqValidFunc,
    ...seqAfter,
  ];

  // ✅ variável global de data da atividade (DD/MM/YYYY)
  const dataAtividade =
    atividadesSeq[0]?.dataFmt || fmtDate(parseToDate(inicioAtv));

  const atividadesInicioIso = atividadesSeq[0]?.dataHora || "";
  const atividadesFimIso = atividadesSeq.length
    ? addMinutesLocalIso(
        atividadesSeq[atividadesSeq.length - 1].dataHora,
        STEP_MIN
      )
    : "";

  const atividadesTotalMin = atividadesSeq.length * STEP_MIN;
  const atividadesTempoTotalFmt = `${Math.floor(atividadesTotalMin / 60)}:${pad(
    atividadesTotalMin % 60
  )}`;

  // ---------------- ROLLBACK ----------------
  const rollbackDyn = (rdm?.rollbackPlan || [])
    .filter((a) => a && (a.descricao || a.responsavel))
    .map((a) => ({
      descricao: a.descricao || "",
      responsavel: a.responsavel || NOME_PADRAO,
    }));

  let rollbackCursor =
    atividadesFimIso || rdm?.inicioRollback || rdm?.inicioAtividades || "";

  const rbSeqBefore = scheduleWithStep(
    rollbackCursor,
    STEP_MIN,
    ROLLBACK_BEFORE
  );
  rollbackCursor = nextStartAfter(rbSeqBefore, rollbackCursor, STEP_MIN);

  const rbSeqDynamic = scheduleWithStep(rollbackCursor, STEP_MIN, rollbackDyn);
  rollbackCursor = nextStartAfter(rbSeqDynamic, rollbackCursor, STEP_MIN);

  const rbSeqValidTec = scheduleWithStep(
    rollbackCursor,
    STEP_MIN,
    ROLLBACK_VALID_TEC
  );
  rollbackCursor = nextStartAfter(rbSeqValidTec, rollbackCursor, STEP_MIN);

  const rbSeqValidFunc = scheduleWithStep(
    rollbackCursor,
    STEP_MIN,
    ROLLBACK_VALID_FUNC
  );
  rollbackCursor = nextStartAfter(rbSeqValidFunc, rollbackCursor, STEP_MIN);

  const rbSeqAfter = scheduleWithStep(rollbackCursor, STEP_MIN, ROLLBACK_AFTER);

  const rollbackSeq = [
    ...rbSeqBefore,
    ...rbSeqDynamic,
    ...rbSeqValidTec,
    ...rbSeqValidFunc,
    ...rbSeqAfter,
  ];

  const dataRollback =
    rollbackSeq[0]?.dataFmt || fmtDate(parseToDate(rollbackCursor));

  const rollbackInicioIso = rollbackSeq[0]?.dataHora || "";
  const rollbackFimIso = rollbackSeq.length
    ? addMinutesLocalIso(rollbackSeq[rollbackSeq.length - 1].dataHora, STEP_MIN)
    : "";

  const rollbackTotalMin = rollbackSeq.length * STEP_MIN;
  const rollbackTempoTotalFmt = `${Math.floor(rollbackTotalMin / 60)}:${pad(
    rollbackTotalMin % 60
  )}`;

  // ---------------- Pessoas ----------------
  const normPessoa = (p = {}) => ({
    nome: p.nome || "",
    area: p.area || "",
    contato: p.contato || "",
  });

  const alinhamentosArr = (rdm?.alinhamentos || [])
    .filter((a) => a && (a.nome || a.area || a.contato))
    .map(normPessoa);

  const executoresArr = (rdm?.executores || [])
    .filter((e) => e && (e.nome || e.area || e.contato))
    .map((e, i) => ({ ...normPessoa(e), idx: i + 1 }));

  const lider = normPessoa(rdm?.liderTecnico);
  const solicitante = normPessoa(rdm?.solicitante);

  // ---------------- Data para o Docxtemplater ----------------
  const data = {
    // Identificação
    titulo: rdm?.titulo ?? "",
    categoria: rdm?.categoria ?? "",
    tipo: rdm?.tipo ?? "",
    classificacao: rdm?.classificacao ?? "",
    impactoNivel: rdm?.impactoNivel ?? "",
    registroPA: rdm?.registroPA ?? "",
    chamadoCASD: rdm?.chamadoCASD ?? "",
    mudancaReincidente: rdm?.mudancaReincidente ?? "",

    // Objetivo e justificativas
    objetivoDescricao: rdm?.objetivoDescricao ?? "",
    oQue: rdm?.oQue ?? "",
    porQue: rdm?.porQue ?? "",
    paraQue: rdm?.paraQue ?? "",
    beneficio: rdm?.beneficio ?? "",

    // Onde/como
    ondeAmbiente: rdm?.ondeAmbiente ?? "",
    ondeServico: rdm?.ondeServico ?? "",
    acao: rdm?.acao ?? "",
    areasAfetadas: rdm?.areasAfetadas ?? "",
    deAcordoResponsavel: rdm?.deAcordoResponsavel ?? "",
    homologacaoRealizada: rdm?.homologacaoRealizada ?? "",

    // Impactos
    impactoNaoExecutar: rdm?.impactoNaoExecutar ?? "",
    impactoAmbiente: rdm?.impactoAmbiente ?? "",

    // Pessoas
    solicitanteNome: solicitante.nome,
    solicitanteArea: solicitante.area,
    solicitanteContato: solicitante.contato,

    alinhamentos: alinhamentosArr,
    executores: executoresArr,

    liderTecnicoNome: lider.nome,
    liderTecnicoArea: lider.area,
    liderTecnicoContato: lider.contato,

    // ✅ Datas "globais"
    dataAtividade, // "DD/MM/YYYY" (use no DOCX se precisar)
    dataRollback,

    // Atividades
    atividadesSeq,
    atividadesSeqBefore: seqBefore,
    atividadesSeqDynamic: seqDynamic,
    atividadesSeqValidTec: seqValidTec,
    atividadesSeqValidFunc: seqValidFunc,
    atividadesSeqAfter: seqAfter,

    atividadesInicioFmt: fmtDateTime(atividadesInicioIso),
    atividadesFimFmt: fmtDateTime(atividadesFimIso),
    atividadesInicioHora: fmtTime(atividadesInicioIso),
    atividadesFimHora: fmtTime(atividadesFimIso),
    atividadesTempoTotalFmt,

    // Rollback
    rollbackSeq,
    rollbackSeqBefore: rbSeqBefore,
    rollbackSeqDynamic: rbSeqDynamic,
    rollbackSeqValidTec: rbSeqValidTec,
    rollbackSeqValidFunc: rbSeqValidFunc,
    rollbackSeqAfter: rbSeqAfter,

    rollbackInicioFmt: fmtDateTime(rollbackInicioIso),
    rollbackFimFmt: fmtDateTime(rollbackFimIso),
    rollbackInicioHora: fmtTime(rollbackInicioIso),
    rollbackFimHora: fmtTime(rollbackFimIso),
    rollbackTempoTotalFmt,

    // util
    stepMinutes: STEP_MIN,
  };

  // ---------------- Renderização do DOCX ----------------
  const content = await loadTemplateArrayBuffer(templateUrl);

  // sanity check (docx começa com "PK")
  const u8 = new Uint8Array(content);
  const sig = String.fromCharCode(u8[0] || 0, u8[1] || 0);
  if (sig !== "PK") {
    throw new Error(
      `Template inválido (não parece .docx). URL: ${templateUrl}`
    );
  }

  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
    delimiters: { start: "{", end: "}" },
  });

  try {
    doc.render(data);
  } catch (e) {
    console.error("Erro docxtemplater:", e);
    throw e;
  }

  const out = doc.getZip().generate({
    type: "blob",
    mimeType: DOCX_MIME,
  });

  downloadBlob(out, "RDM.docx");
}
