import { compactText, sanitizeTraceText, uniq } from "../utils/sanitize.js";

const SUCCESS_HTTP = new Set(["200", "201", "204"]);

function countBy(values = []) {
  const map = new Map();
  values.filter(Boolean).forEach((value) => map.set(value, (map.get(value) || 0) + 1));
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function offsetSeconds(event, startMs) {
  if (!event?.timestampMs || !startMs) return null;
  return Math.max(0, Math.round((event.timestampMs - startMs) / 1000));
}

function eventTitle(event) {
  if (event.apiName) return `API ${event.apiName}`;
  if (event.transferCode || event.action === "TRANSFER") return "Transferência";
  if (event.transcript) return "Transcrição";
  return event.action || event.scriptName || `Evento ${event.index}`;
}

function severityFor(event) {
  if (event.errorScore >= 3) return "error";
  if (event.errorScore > 0 || (event.httpStatusCode && !SUCCESS_HTTP.has(String(event.httpStatusCode)))) return "warning";
  if (event.action === "TRANSFER" || event.transferCode) return "success";
  return "info";
}

function summarizeEvent(event) {
  return compactText([
    event.result,
    event.url,
    event.transcript ? `Texto: ${event.transcript}` : "",
    event.fullText,
  ].filter(Boolean).join(" "), 220);
}

function buildTimeline(events) {
  const startMs = events.find((event) => event.timestampMs)?.timestampMs || null;
  return events.map((event) => ({
    id: `timeline-${event.index}`,
    eventIndex: event.index,
    time: event.time,
    offsetSeconds: offsetSeconds(event, startMs),
    action: event.action || "EVENT",
    scriptName: event.scriptName,
    title: eventTitle(event),
    description: summarizeEvent(event),
    severity: severityFor(event),
    tags: event.tags || [],
  }));
}

function buildScriptTree(events) {
  const root = {
    id: "root",
    label: "Trace",
    scriptName: null,
    action: "ROOT",
    children: [],
    countEvents: events.length,
    startedAt: events[0]?.time || null,
    endedAt: events[events.length - 1]?.time || null,
  };
  const stack = [root];
  const byScript = new Map();

  for (const event of events) {
    const script = event.scriptName || "Sem script";
    let node = byScript.get(script);
    if (!node || ["BEGIN", "RUNSUB", "RUNSCRIPT"].includes(event.action)) {
      node = {
        id: `script-${byScript.size + 1}-${event.index}`,
        label: script,
        scriptName: script,
        action: event.action || "SCRIPT",
        children: [],
        countEvents: 0,
        startedAt: event.time,
        endedAt: event.time,
        eventIndexes: [],
      };
      const parent = event.action === "RETURN" ? root : stack[stack.length - 1] || root;
      parent.children.push(node);
      byScript.set(script, node);
      if (["BEGIN", "RUNSUB", "RUNSCRIPT"].includes(event.action)) stack.push(node);
    }

    node.countEvents += 1;
    node.endedAt = event.time || node.endedAt;
    node.eventIndexes.push(event.index);
    if (event.action === "RETURN" && stack.length > 1) stack.pop();
  }

  if (!root.children.length) {
    for (const item of countBy(events.map((event) => event.scriptName)).slice(0, 80)) {
      root.children.push({
        id: `script-${root.children.length + 1}`,
        label: item.name,
        scriptName: item.name,
        action: "SCRIPT",
        children: [],
        countEvents: item.count,
        startedAt: null,
        endedAt: null,
      });
    }
  }

  return root;
}

function buildApiCalls(events) {
  const apiEvents = events.filter((event) => event.apiName || event.action === "REST_API" || /MakeRestRequest/i.test(event.fullText || ""));
  return apiEvents.map((event) => {
    const next = events.find((candidate) =>
      candidate.index > event.index &&
      (!event.scriptName || candidate.scriptName === event.scriptName) &&
      (!event.apiName || candidate.apiName === event.apiName || /resultSet|HTTPSTATUSCODE|errorArgList/i.test(candidate.fullText || ""))
    );
    const derivedLatency = event.latencyMs ?? (event.timestampMs && next?.timestampMs ? next.timestampMs - event.timestampMs : null);
    const timeoutSuspected = /timeout/i.test(event.fullText || "") || (event.timeoutMs && derivedLatency && derivedLatency >= event.timeoutMs);
    const statusBad = event.httpStatusCode && !SUCCESS_HTTP.has(String(event.httpStatusCode));
    return {
      id: `api-${event.index}`,
      eventIndex: event.index,
      apiName: event.apiName || "REST_API",
      scriptName: event.scriptName,
      method: event.httpMethod,
      url: event.url,
      timeoutMs: event.timeoutMs,
      resultSet: /resultSet/i.test(event.fullText || ""),
      errorArgList: /errorArgList/i.test(event.fullText || ""),
      responseHeaders: /responseHeaders/i.test(event.fullText || ""),
      httpStatusCode: event.httpStatusCode,
      startTime: event.time,
      endTime: next?.time || null,
      latencyMs: derivedLatency,
      timeoutSuspected: !!timeoutSuspected,
      result: event.result,
      isSuspicious: !!timeoutSuspected || !!statusBad || event.errorScore >= 3,
      rawPreview: compactText(event.fullText, 500),
    };
  });
}

function buildErrors(events) {
  return events
    .filter((event) => event.errorScore > 0)
    .map((event) => {
      const previousEvent = events[event.index - 2] || null;
      const nextEvent = events[event.index] || null;
      let explanation = "A palavra erro aparece apenas como parâmetro ou menção textual.";
      if (event.httpStatusCode && !SUCCESS_HTTP.has(String(event.httpStatusCode))) explanation = "HTTP status indica falha.";
      else if (/timeout/i.test(event.fullText || "")) explanation = "Timeout suspeito.";
      else if (event.errorScore >= 3) explanation = "O contexto indica falha provável.";
      return {
        id: `error-${event.index}`,
        event,
        previousEvent,
        nextEvent,
        severity: event.errorScore >= 4 ? "confirmed" : event.errorScore >= 3 ? "probable" : "mention",
        explanation,
      };
    });
}

function buildTranscriptions(events) {
  return events
    .filter((event) => event.transcript || /transcript|Texto:|Confian[çc]a|intent|inten[cç][aã]o|categoria|scriptPointIA/i.test(event.fullText || ""))
    .map((event) => ({
      id: `transcription-${event.index}`,
      eventIndex: event.index,
      timestamp: event.time,
      scriptName: event.scriptName,
      transcript: event.transcript || compactText(event.fullText, 180),
      confidence: event.transcriptionConfidence,
      intent: event.intent || null,
      explanation: /explica[cç][aã]o\s*[:=]\s*([^;\n\r|]+)/i.exec(event.fullText || "")?.[1] || null,
      relatedEvents: [events[event.index - 2], event, events[event.index]].filter(Boolean),
    }));
}

function buildTransfers(events) {
  return events
    .filter((event) => event.transferCode || event.action === "TRANSFER" || /TRANSFERENCIA_URA_OPER|ROTEAMENTO|COUNTAGENTS|WAIT|operador|fila|hold music/i.test(event.fullText || ""))
    .map((event) => ({
      id: `transfer-${event.index}`,
      eventIndex: event.index,
      timestamp: event.time,
      scriptName: event.scriptName,
      transferCode: event.transferCode,
      transferReason: /rejection|max rejection/i.test(event.fullText || "") ? "Rejeição/menu" : /COUNTAGENTS|fila/i.test(event.fullText || "") ? "Roteamento/fila" : "Transferência detectada",
      queue: /fila\s*[:=]\s*([^;\n\r|]+)/i.exec(event.fullText || "")?.[1] || null,
      lastEventsBeforeTransfer: events.slice(Math.max(0, event.index - 6), event.index - 1),
    }));
}

function buildSearchIndex(events) {
  return events.map((event) => ({
    index: event.index,
    type: "event",
    text: sanitizeTraceText([
      event.contactId,
      event.msisdn,
      event.scriptName,
      event.action,
      event.apiName,
      event.httpStatusCode,
      event.transcript,
      event.transferCode,
      event.fullText,
    ].filter(Boolean).join(" "), { keepLines: false }).toLowerCase(),
  }));
}

function buildLastEvent(events) {
  const confirmed = events.find((event) => event.errorScore >= 4);
  if (confirmed) {
    return {
      mode: "failure",
      previousEvent: events[confirmed.index - 2] || null,
      targetEvent: confirmed,
      lastFiveEvents: events.slice(Math.max(0, confirmed.index - 5), confirmed.index),
    };
  }
  return {
    mode: "end",
    previousEvent: events[events.length - 2] || null,
    targetEvent: events[events.length - 1] || null,
    lastFiveEvents: events.slice(-5),
  };
}

export function createAutomaticReport(summary, analysis) {
  const scripts = (summary.mostFrequentScripts || []).slice(0, 3).map((item) => item.name).join(", ") || "fluxo não identificado";
  const transcription = analysis.transcriptions?.[0];
  const ending = analysis.transfers?.length ? "transferência" : "encerramento";
  return `Chamada iniciada em ${summary.startTime || "-"} e finalizada em ${summary.endTime || "-"}, duração aproximada de ${summary.durationSeconds ?? "-"} segundos. Foram executados ${summary.totalEvents} eventos, ${summary.mostFrequentScripts?.length || 0} scripts e ${analysis.apiCalls.length} chamadas REST. A chamada passou pelo fluxo ${scripts}${transcription ? `, detectou transcrição "${transcription.transcript}" com confiança ${transcription.confidence ?? "-"}` : ""}, e terminou em ${ending}. Foram encontrados ${analysis.errors.filter((item) => item.event.errorScore >= 3).length} pontos suspeitos.`;
}

export function analyzeEvents(events = []) {
  const ordered = [...events].sort((a, b) => (a.timestampMs ?? Number.MAX_SAFE_INTEGER) - (b.timestampMs ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
  const startTime = ordered.find((event) => event.time)?.time || null;
  const endTime = [...ordered].reverse().find((event) => event.time)?.time || null;
  const startMs = ordered.find((event) => event.timestampMs)?.timestampMs || null;
  const endMs = [...ordered].reverse().find((event) => event.timestampMs)?.timestampMs || null;
  const timeline = buildTimeline(ordered);
  const scriptTree = buildScriptTree(ordered);
  const apiCalls = buildApiCalls(ordered);
  const errors = buildErrors(ordered);
  const transcriptions = buildTranscriptions(ordered);
  const transfers = buildTransfers(ordered);
  const summary = {
    totalEvents: ordered.length,
    startTime,
    endTime,
    durationSeconds: startMs && endMs ? Math.round((endMs - startMs) / 1000) : null,
    contactIds: uniq(ordered.map((event) => event.contactId)),
    msisdns: uniq(ordered.map((event) => event.msisdn)),
    busNos: uniq(ordered.map((event) => event.busNo)),
    hosts: uniq(ordered.flatMap((event) => [event.iisHost, event.vcHost])),
    mostFrequentScripts: countBy(ordered.map((event) => event.scriptName)).slice(0, 20),
    mostFrequentActions: countBy(ordered.map((event) => event.action)).slice(0, 20),
    totalApiCalls: apiCalls.length,
    totalErrors: errors.filter((item) => item.event.errorScore >= 3).length,
    totalTransfers: transfers.length,
    totalTranscriptions: transcriptions.length,
  };
  const analysis = {
    summary,
    timeline,
    scriptTree,
    apiCalls,
    errors,
    transcriptions,
    transfers,
    lastRelevantEvent: ordered[ordered.length - 1] || null,
    lastEventBeforeFailureOrEnd: buildLastEvent(ordered),
    searchIndex: buildSearchIndex(ordered),
  };
  analysis.reportText = createAutomaticReport(summary, analysis);
  return analysis;
}
