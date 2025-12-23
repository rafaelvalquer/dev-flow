// src/utils/buildCronograma.js

const pad = (n) => String(n).padStart(2, "0");

const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d)) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const addMinutesIso = (iso, min) => {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + min);
  return d.toISOString();
};

export function scheduleWithStep(inicioIso, stepMin, items) {
  if (!inicioIso) return [];
  let cursor = inicioIso;

  return (items || []).map((it) => {
    const startIso = cursor;
    cursor = addMinutesIso(cursor, stepMin);

    return {
      ...(it || {}),
      dataHora: startIso,
      horaFmt: fmtTime(startIso),
    };
  });
}

export function nextStartAfter(seq, currentStart, stepMin) {
  return seq && seq.length
    ? addMinutesIso(seq[seq.length - 1].dataHora, stepMin)
    : currentStart;
}

// ===== Defaults (para preview ficar igual ao DOCX) =====
export const DEFAULT_NOME_PADRAO = "Suporte Infra Call Center";

export const DEFAULT_PADRAO_BEFORE = [
  {
    descricao:
      "Comunicar COTI (coti@claro.com.br) e GMUD (gerencia.mudancas@claro.com.br) o início da RDM",
    responsavel: DEFAULT_NOME_PADRAO,
    noDuration: true,
  },
  {
    descricao:
      "Enviar e-mail comunicando o início da Atividade para os destinatários: LAUDEJOR laudejor.coutinho@terceiros.net.com.br; Suporte InfraCC Suporte.InfraCC@claro.com.br; Gerencia de Mudanças CLARO Gerencia.Mudancas@claro.com.br; Gerencia Mudanças TI Gerencia.Net@net.com.br; COTI/OSS NET coti@netservicos.com.br",
    responsavel: DEFAULT_NOME_PADRAO,
  },
];

export const DEFAULT_PADRAO_VALID_TEC = [
  {
    descricao:
      "Validar que fluxos atualizados estejam nos destinos corretos das pastas de PRD.",
    responsavel: DEFAULT_NOME_PADRAO,
  },
];

export const DEFAULT_PADRAO_VALID_FUNC = [
  {
    descricao:
      "Realizar chamadas para URA com um telefone que esteja dentro do mailing do projeto, para validar transferência centralizada na nova célula de atendimento.",
    responsavel: DEFAULT_NOME_PADRAO,
  },
];

export const DEFAULT_PADRAO_AFTER = [
  {
    descricao:
      "Comunicar COTI (coti@claro.com.br) e GMUD (gerencia.mudancas@claro.com.br) o término da RDM",
    responsavel: DEFAULT_NOME_PADRAO,
  },
];

function withBlock(seq, bloco) {
  return (seq || []).map((it) => ({ ...it, bloco }));
}

// Recebe o rdm e (opcional) override dos padrões, e retorna blocos + seq + totalMin
export function buildCronogramaAtividades({
  rdm,
  STEP_MIN,
  NOME_PADRAO,
  PADRAO_BEFORE,
  PADRAO_VALID_TEC,
  PADRAO_VALID_FUNC,
  PADRAO_AFTER,
}) {
  const stepMin = Number(STEP_MIN ?? rdm?.stepMinutes ?? 15);

  const nomePadrao = NOME_PADRAO ?? DEFAULT_NOME_PADRAO;

  const before = PADRAO_BEFORE ?? DEFAULT_PADRAO_BEFORE;
  const validTec = PADRAO_VALID_TEC ?? DEFAULT_PADRAO_VALID_TEC;
  const validFunc = PADRAO_VALID_FUNC ?? DEFAULT_PADRAO_VALID_FUNC;
  const after = PADRAO_AFTER ?? DEFAULT_PADRAO_AFTER;

  const inicioAtv = rdm?.inicioAtividades || "";

  const dinamicos = (rdm?.atividades || [])
    .filter((a) => a && (a.descricao || a.responsavel))
    .map((a) => ({
      descricao: a.descricao || "",
      responsavel: a.responsavel || nomePadrao,
    }));

  let cursor = inicioAtv;

  const seqBeforeRaw = scheduleWithStep(cursor, stepMin, before);
  const seqBefore = withBlock(seqBeforeRaw, "before");
  cursor = nextStartAfter(seqBeforeRaw, cursor, stepMin);

  const seqDynamicRaw = scheduleWithStep(cursor, stepMin, dinamicos);
  const seqDynamic = withBlock(seqDynamicRaw, "dynamic");
  cursor = nextStartAfter(seqDynamicRaw, cursor, stepMin);

  const seqValidTecRaw = scheduleWithStep(cursor, stepMin, validTec);
  const seqValidTec = withBlock(seqValidTecRaw, "validTec");
  cursor = nextStartAfter(seqValidTecRaw, cursor, stepMin);

  const seqValidFuncRaw = scheduleWithStep(cursor, stepMin, validFunc);
  const seqValidFunc = withBlock(seqValidFuncRaw, "validFunc");
  cursor = nextStartAfter(seqValidFuncRaw, cursor, stepMin);

  const seqAfterRaw = scheduleWithStep(cursor, stepMin, after);
  const seqAfter = withBlock(seqAfterRaw, "after");

  const seq = [
    ...seqBefore,
    ...seqDynamic,
    ...seqValidTec,
    ...seqValidFunc,
    ...seqAfter,
  ];

  const counted = seq.filter((it) => !it.noDuration).length;
  const totalMin = counted * stepMin;

  return {
    blocks: { seqBefore, seqDynamic, seqValidTec, seqValidFunc, seqAfter },
    seq,
    totalMin,
  };
}
