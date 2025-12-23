// src/utils/rdmDocx.js
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

// ---------- Utilidades de data/hora ----------
const pad = (n) => String(n).padStart(2, "0");

const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const addMinutesIso = (iso, min) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() + min);
  return d.toISOString();
};

// Monta sequência com horários; NÃO consome step quando item.noDuration === true
function scheduleWithStep(inicioIso, stepMin, items) {
  if (!inicioIso) return [];
  let cursor = inicioIso;

  return (items || []).map((it) => {
    const startIso = cursor;

    if (!it?.noDuration) {
      cursor = addMinutesIso(cursor, stepMin);
    }

    return {
      ...it,
      dataHora: startIso,
      dataHoraFmt: fmtDateTime(startIso),
      horaFmt: fmtTime(startIso),
    };
  });
}

// retorna o próximo início: último início do bloco + step (apenas se o último NÃO for noDuration)
function nextStartAfter(seq, currentStart, stepMin) {
  if (!seq || !seq.length) return currentStart;
  const last = seq[seq.length - 1];
  return last?.noDuration
    ? last.dataHora
    : addMinutesIso(last.dataHora, stepMin);
}

const NOME_PADRAO = "Suporte Infra Call Center";

// ---------- Blocos padrão solicitados ----------
const PADRAO_BEFORE = [
  {
    descricao:
      "Comunicar COTI (coti@claro.com.br) e GMUD (gerencia.mudancas@claro.com.br) o início da RDM",
    responsavel: NOME_PADRAO,
    noDuration: true,
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

// ---------- Rollback: blocos padrão ----------
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
    noDuration: true,
  },
];

export async function gerarRdmDocx(rdm, opts = {}) {
  const templateUrl = opts.templateUrl ?? "/templates/Modelo-RDM.docx";
  const STEP_MIN = Number(opts.stepMinutes ?? rdm?.stepMinutes ?? 15);

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

  const atividadesInicioIso = atividadesSeq[0]?.dataHora || "";
  const atividadesTotalMin = atividadesSeq.reduce(
    (acc, it) => acc + (it?.noDuration ? 0 : STEP_MIN),
    0
  );

  const atividadesFimIso =
    atividadesInicioIso && atividadesTotalMin > 0
      ? addMinutesIso(atividadesInicioIso, atividadesTotalMin)
      : "";

  const atividadesTempoTotalFmt = `${Math.floor(atividadesTotalMin / 60)}:${pad(
    atividadesTotalMin % 60
  )}`;

  // ---------------- ROLLBACK ----------------

  // itens dinâmicos: descrição/responsável
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

  // NÃO zere horaFmt/dataHoraFmt aqui
  const rollbackSeq = [
    ...rbSeqBefore,
    ...rbSeqDynamic,
    ...rbSeqValidTec,
    ...rbSeqValidFunc,
    ...rbSeqAfter,
  ];

  const rollbackInicioIso = rollbackSeq[0]?.dataHora || "";
  const rollbackTotalMin = rollbackSeq.reduce(
    (acc, it) => acc + (it?.noDuration ? 0 : STEP_MIN),
    0
  );

  const rollbackFimIso =
    rollbackInicioIso && rollbackTotalMin > 0
      ? addMinutesIso(rollbackInicioIso, rollbackTotalMin)
      : "";

  const rollbackTempoTotalFmt = `${Math.floor(rollbackTotalMin / 60)}:${pad(
    rollbackTotalMin % 60
  )}`;

  // ---------- Pessoas ----------
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

  // ---------- Data para o Docxtemplater ----------
  const data = {
    // Campos simples
    titulo: rdm?.titulo ?? "",
    categoria: rdm?.categoria ?? "",
    tipo: rdm?.tipo ?? "",
    classificacao: rdm?.classificacao ?? "",
    impactoNivel: rdm?.impactoNivel ?? "",
    objetivoDescricao: rdm?.objetivoDescricao ?? "",
    oQue: rdm?.oQue ?? "",
    porQue: rdm?.porQue ?? "",
    paraQue: rdm?.paraQue ?? "",
    beneficio: rdm?.beneficio ?? "",
    ondeAmbiente: rdm?.ondeAmbiente ?? "",
    ondeServico: rdm?.ondeServico ?? "",
    acao: rdm?.acao ?? "",
    areasAfetadas: rdm?.areasAfetadas ?? "",
    deAcordoResponsavel: rdm?.deAcordoResponsavel ?? "",
    homologacaoRealizada: rdm?.homologacaoRealizada ?? "",
    impactoNaoExecutar: rdm?.impactoNaoExecutar ?? "",
    impactoAmbiente: rdm?.impactoAmbiente ?? "",

    // Pessoas
    alinhamentos: alinhamentosArr,
    executores: executoresArr,
    liderTecnicoNome: lider.nome,
    liderTecnicoArea: lider.area,
    liderTecnicoContato: lider.contato,

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
  };

  // --------- Renderização do DOCX ---------
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
    delimiters: { start: "{", end: "}" }, // garante uso de {titulo}, {categoria}, etc.
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
