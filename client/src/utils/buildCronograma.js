// src/utils/buildCronograma.js

const pad = (n) => String(n).padStart(2, "0");

// Converte Date -> "YYYY-MM-DDTHH:mm" (LOCAL) (sem Z)
const toLocalIsoMinute = (d) => {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
};

// Parse seguro de "YYYY-MM-DDTHH:mm" (datetime-local) e também ISO com Z
const parseToDate = (iso) => {
  if (!iso) return null;

  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) return d;

  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;

  const [, yy, mo, dd, hh, mm] = m;
  const out = new Date(
    Number(yy),
    Number(mo) - 1,
    Number(dd),
    Number(hh),
    Number(mm),
    0,
    0
  );
  return Number.isNaN(out.getTime()) ? null : out;
};

const fmtTime = (isoOrDate) => {
  if (!isoOrDate) return "";
  const d = isoOrDate instanceof Date ? isoOrDate : parseToDate(isoOrDate);
  if (!d) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// ✅ Sempre avança o cursor (independente de noDuration)
// noDuration só influencia o totalMin (cálculo do tempo total)
export function scheduleWithStep(inicioIso, stepMin, items) {
  const step = normalizeStep(stepMin, 15);
  if (!inicioIso) return [];

  let cursorDate = parseToDate(inicioIso);
  if (!cursorDate) return [];

  return (items || []).map((it) => {
    const start = new Date(cursorDate.getTime());
    cursorDate.setMinutes(cursorDate.getMinutes() + step);

    return {
      ...(it || {}),
      dataHora: toLocalIsoMinute(start),
      horaFmt: fmtTime(start),
    };
  });
}

export function nextStartAfter(seq, currentStart, stepMin) {
  const step = normalizeStep(stepMin, 15);

  return seq && seq.length
    ? addMinutesLocalIso(seq[seq.length - 1].dataHora, step)
    : currentStart;
}

// ===== Defaults (para preview ficar igual ao DOCX) =====
export const DEFAULT_NOME_PADRAO = "Suporte Infra Call Center";

export const DEFAULT_PADRAO_BEFORE = [
  {
    descricao:
      "Comunicar COTI (coti@claro.com.br) e GMUD (gerencia.mudancas@claro.com.br) o início da RDM",
    responsavel: DEFAULT_NOME_PADRAO,
    // ✅ REMOVIDO noDuration daqui para não repetir o horário do próximo item
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
    // ✅ Para manter o tempo total/termino sem “estourar”, marca o ÚLTIMO como sem duração
    // (vai aparecer com horário sequencial, mas não entra no totalMin)
    noDuration: true,
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
  const stepMin = normalizeStep(STEP_MIN ?? rdm?.stepMinutes, 15);

  const nomePadrao = NOME_PADRAO ?? DEFAULT_NOME_PADRAO;

  const before = PADRAO_BEFORE ?? DEFAULT_PADRAO_BEFORE;
  const validTec = PADRAO_VALID_TEC ?? DEFAULT_PADRAO_VALID_TEC;
  const validFunc = PADRAO_VALID_FUNC ?? DEFAULT_PADRAO_VALID_FUNC;
  const after = PADRAO_AFTER ?? DEFAULT_PADRAO_AFTER;

  const inicioAtv = rdm?.inicioAtividades || "";
  let cursor = inicioAtv;

  const dinamicos = (rdm?.atividades || [])
    .filter((a) => a && (a.descricao || a.responsavel))
    .map((a) => ({
      descricao: a.descricao || "",
      responsavel: a.responsavel || nomePadrao,
    }));

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

  // totalMin desconsidera itens noDuration
  const counted = seq.filter((it) => !it.noDuration).length;
  const totalMin = counted * stepMin;

  return {
    blocks: { seqBefore, seqDynamic, seqValidTec, seqValidFunc, seqAfter },
    seq,
    totalMin,
  };
}
