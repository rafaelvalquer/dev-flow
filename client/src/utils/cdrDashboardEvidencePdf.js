import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function stampForFile(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}

function fileName(mode = "single") {
  const suffix = mode === "compare" ? "comparativo-cdr" : "dashboard-cdr";
  return `evidencia-${suffix}-${stampForFile()}.pdf`;
}

function filterSummary(filters = {}) {
  const active = [];
  for (let index = 1; index <= 5; index += 1) {
    const campo = String(filters[`campo${index}`] || "0");
    const valor = String(filters[`valor${index}`] || "");
    if (campo !== "0" && valor) active.push(`${campo}: ${valor}`);
  }
  if (!active.length && filters.segmento) active.push(`segmento: ${filters.segmento}`);
  return active.join(" | ") || "Sem filtros adicionais";
}

function addFooter(pdf) {
  const pageCount = pdf.getNumberOfPages();
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();

  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(`Pagina ${page} de ${pageCount}`, width - 12, height - 7, {
      align: "right",
    });
  }
}

function isCompareEvidence(filters = {}, analytics = {}) {
  return filters?.mode === "compare" || analytics?.source === "portal-export-compare";
}

function addSingleHeader(pdf, { analytics, filters }) {
  const generatedAt = new Date().toLocaleString("pt-BR");
  const summary = analytics?.summary || {};
  const width = pdf.internal.pageSize.getWidth();

  pdf.setFillColor(248, 250, 252);
  pdf.rect(0, 0, width, 45, "F");
  pdf.setTextColor(24, 24, 27);
  pdf.setFontSize(18);
  pdf.text("Dashboard CDR", 12, 17);
  pdf.setFontSize(9);
  pdf.setTextColor(82, 82, 91);
  pdf.text(`Periodo: ${filters?.dataInicial || "-"} a ${filters?.dataFinal || "-"}`, 12, 27);
  pdf.text(`Filtros: ${filterSummary(filters)}`, 12, 33, {
    maxWidth: width - 92,
  });
  pdf.text(`Gerado em: ${generatedAt}`, 12, 39);

  pdf.setTextColor(24, 24, 27);
  pdf.text(`Chamadas: ${numberBr(summary.analyzedCalls)}`, width - 12, 27, {
    align: "right",
  });
  pdf.text(`Tempo medio total: ${summary.averageTotalFormatted || "0:00"}`, width - 12, 33, {
    align: "right",
  });
  pdf.text(`Transferencias: ${numberBr(summary.transferTotal)}`, width - 12, 39, {
    align: "right",
  });
}

function addCompareHeader(pdf, { analytics, filters }) {
  const generatedAt = new Date().toLocaleString("pt-BR");
  const width = pdf.internal.pageSize.getWidth();
  const labels = analytics?.comparison?.labels || {
    left: filters?.left?.label || analytics?.left?.label || "Periodo A",
    right: filters?.right?.label || analytics?.right?.label || "Periodo B",
  };
  const leftFilters = filters?.left?.filters || analytics?.left?.filters || {};
  const rightFilters = filters?.right?.filters || analytics?.right?.filters || {};
  const leftSummary = analytics?.left?.summary || {};
  const rightSummary = analytics?.right?.summary || {};

  pdf.setFillColor(248, 250, 252);
  pdf.rect(0, 0, width, 58, "F");
  pdf.setTextColor(24, 24, 27);
  pdf.setFontSize(18);
  pdf.text("Comparativo CDR", 12, 17);
  pdf.setFontSize(9);
  pdf.setTextColor(82, 82, 91);
  pdf.text(
    `${labels.left}: ${leftFilters.dataInicial || "-"} a ${leftFilters.dataFinal || "-"}`,
    12,
    27,
  );
  pdf.text(
    `${labels.right}: ${rightFilters.dataInicial || "-"} a ${rightFilters.dataFinal || "-"}`,
    12,
    33,
  );
  pdf.text(`Filtros ${labels.left}: ${filterSummary(leftFilters)}`, 12, 39, {
    maxWidth: width - 24,
  });
  pdf.text(`Filtros ${labels.right}: ${filterSummary(rightFilters)}`, 12, 45, {
    maxWidth: width - 24,
  });
  pdf.text(`Gerado em: ${generatedAt}`, 12, 53);

  pdf.setTextColor(24, 24, 27);
  pdf.text(`${labels.left}: ${numberBr(leftSummary.analyzedCalls)} chamadas`, width - 12, 27, {
    align: "right",
  });
  pdf.text(`${labels.right}: ${numberBr(rightSummary.analyzedCalls)} chamadas`, width - 12, 33, {
    align: "right",
  });
}

function addHeader(pdf, { analytics, filters }) {
  if (isCompareEvidence(filters, analytics)) {
    addCompareHeader(pdf, { analytics, filters });
    return 70;
  }
  addSingleHeader(pdf, { analytics, filters });
  return 56;
}

function expandScrollableAreas(root) {
  root.removeAttribute("hidden");
  root.style.display = "block";
  root.querySelectorAll("[hidden]").forEach((element) => {
    element.removeAttribute("hidden");
    element.style.display = "block";
  });
  root.querySelectorAll("[data-pdf-expand]").forEach((element) => {
    element.style.maxHeight = "none";
    element.style.overflow = "visible";
  });
}

function prepareReportClone(element) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "1120px";
  container.style.background = "#ffffff";
  container.style.padding = "0";
  container.style.zIndex = "-1";

  const clone = element.cloneNode(true);
  clone.style.width = "1120px";
  clone.style.maxWidth = "1120px";
  clone.style.background = "#ffffff";
  clone.style.transform = "none";
  clone.style.margin = "0";
  clone.querySelectorAll(".xl\\:grid-cols-2").forEach((node) => {
    node.style.gridTemplateColumns = "1fr";
  });
  const originalCanvases = element.querySelectorAll("canvas");
  const clonedCanvases = clone.querySelectorAll("canvas");
  clonedCanvases.forEach((clonedCanvas, index) => {
    const originalCanvas = originalCanvases[index];
    if (!originalCanvas) return;
    clonedCanvas.width = originalCanvas.width;
    clonedCanvas.height = originalCanvas.height;
    clonedCanvas.style.width = originalCanvas.style.width;
    clonedCanvas.style.height = originalCanvas.style.height;
    const context = clonedCanvas.getContext("2d");
    context?.drawImage(originalCanvas, 0, 0);
  });
  expandScrollableAreas(clone);

  container.appendChild(clone);
  document.body.appendChild(container);
  return { container, clone };
}

async function captureElement(element) {
  const { container, clone } = prepareReportClone(element);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    return await html2canvas(clone, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      width: clone.scrollWidth,
      height: clone.scrollHeight,
      windowWidth: Math.max(1120, clone.scrollWidth),
      windowHeight: Math.max(900, clone.scrollHeight),
    });
  } finally {
    container.remove();
  }
}

function addCanvasToPdf(pdf, canvas, title, cursorY) {
  const margin = 12;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const usableWidth = pageWidth - margin * 2;
  const footerReserve = 14;
  const pageTop = margin;
  const gapAfterTitle = 5;

  let y = cursorY;
  if (y > pageHeight - 48) {
    pdf.addPage();
    y = pageTop;
  }

  pdf.setTextColor(24, 24, 27);
  pdf.setFontSize(12);
  pdf.text(title, margin, y);
  y += gapAfterTitle;

  const pxPerMm = canvas.width / usableWidth;
  let offsetY = 0;

  while (offsetY < canvas.height) {
    const availableMm = pageHeight - y - footerReserve;
    if (availableMm < 30) {
      pdf.addPage();
      y = pageTop;
      continue;
    }

    const remainingPx = canvas.height - offsetY;
    const maxSliceHeightPx = Math.max(1, Math.floor(availableMm * pxPerMm));
    const sliceHeightPx = Math.min(remainingPx, maxSliceHeightPx);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeightPx;
    const context = sliceCanvas.getContext("2d");
    context.drawImage(
      canvas,
      0,
      offsetY,
      canvas.width,
      sliceHeightPx,
      0,
      0,
      canvas.width,
      sliceHeightPx,
    );

    const imageHeightMm = sliceHeightPx / pxPerMm;
    pdf.addImage(
      sliceCanvas.toDataURL("image/png"),
      "PNG",
      margin,
      y,
      usableWidth,
      imageHeightMm,
      undefined,
      "FAST",
    );

    offsetY += sliceHeightPx;
    y += imageHeightMm + 6;

    if (offsetY < canvas.height) {
      pdf.addPage();
      y = pageTop;
    }
  }

  return y;
}

export async function createDashboardEvidencePdfFile({
  analytics,
  filters,
  modules,
  moduleElements,
}) {
  const selected = (modules || []).filter((module) => module?.selected);
  if (!selected.length) {
    throw new Error("Selecione pelo menos um modulo para gerar a evidencia.");
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const cursorStart = addHeader(pdf, { analytics, filters });

  let cursorY = cursorStart;
  for (const module of selected) {
    const element = moduleElements?.[module.id];
    if (!element) continue;
    const canvas = await captureElement(element);
    cursorY = addCanvasToPdf(pdf, canvas, module.label, cursorY) + 4;
  }

  addFooter(pdf);
  return new File([pdf.output("blob")], fileName(isCompareEvidence(filters, analytics) ? "compare" : "single"), {
    type: "application/pdf",
  });
}
