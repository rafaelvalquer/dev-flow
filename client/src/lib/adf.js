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

export function adfToText(adf) {
  if (!adf) return "";

  const parts = [];

  function walk(node) {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (node.type === "text") {
      parts.push(node.text || "");
      return;
    }

    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }

    // nós com conteúdo
    if (node.content && Array.isArray(node.content)) {
      walk(node.content);
    }

    // separadores simples
    if (node.type === "paragraph") parts.push("\n");
    if (node.type === "tableRow") parts.push("\n");
    if (node.type === "tableCell" || node.type === "tableHeader")
      parts.push(" | ");
  }

  walk(adf);

  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function adfCellText(cellNode) {
  if (!cellNode) return "";
  // cellNode.content geralmente tem paragraphs
  return adfToText(cellNode)
    .replace(/\s*\|\s*/g, " ")
    .trim();
}

export function containsTagInComments(commentsResponse, tag) {
  const comments = commentsResponse?.comments || [];
  for (const c of comments) {
    const txt = adfToText(c.body || c);
    if (txt.includes(tag)) return true;
  }
  return false;
}
