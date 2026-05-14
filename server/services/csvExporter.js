function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function eventsToCsv(events = []) {
  const columns = [
    "index",
    "time",
    "contactId",
    "msisdn",
    "scriptName",
    "action",
    "apiName",
    "httpMethod",
    "url",
    "timeoutMs",
    "httpStatusCode",
    "latencyMs",
    "transferCode",
    "isError",
    "errorScore",
    "result",
    "summary",
    "tags",
  ];
  const rows = [columns.map(csvEscape).join(",")];
  for (const event of events) {
    rows.push(columns.map((column) => {
      if (column === "summary") return csvEscape(event.fullText?.slice(0, 400));
      if (column === "tags") return csvEscape((event.tags || []).join("|"));
      return csvEscape(event[column]);
    }).join(","));
  }
  return rows.join("\n");
}
