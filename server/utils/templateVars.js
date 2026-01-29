// server/utils/templateVars.js
export function applyTemplate(text, vars = {}) {
  const src = String(text || "");
  return src.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars?.[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

export function adfFromPlainText(text) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: String(text || "") }],
      },
    ],
  };
}
