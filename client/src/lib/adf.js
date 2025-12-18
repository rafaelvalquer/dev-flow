export function adfFromTagAndText(tag, text) {
  const content = [{ type: "text", text: tag }, { type: "hardBreak" }];
  const lines = String(text || "").split("\n");
  lines.forEach((line, idx) => {
    if (line.length) content.push({ type: "text", text: line });
    if (idx < lines.length - 1) content.push({ type: "hardBreak" });
  });
  return { type: "doc", version: 1, content: [{ type: "paragraph", content }] };
}

export function adfToPlainText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (Array.isArray(node.content)) {
    const inner = node.content.map(adfToPlainText).join("");
    return node.type === "paragraph" ? inner + "\n" : inner;
  }
  return "";
}
