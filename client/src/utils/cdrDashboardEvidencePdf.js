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

function fileName() {
  return `evidencia-dashboard-cdr-${stampForFile()}.pdf`;
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

function addHeader(pdf, { analytics, filters }) {
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
  pdf.text(`Segmento: ${filters?.segmento || "-"}`, 12, 33);
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

function expandScrollableAreas(root) {
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
  addHeader(pdf, { analytics, filters });

  let cursorY = 56;
  for (const module of selected) {
    const element = moduleElements?.[module.id];
    if (!element) continue;
    const canvas = await captureElement(element);
    cursorY = addCanvasToPdf(pdf, canvas, module.label, cursorY) + 4;
  }

  addFooter(pdf);
  return new File([pdf.output("blob")], fileName(), {
    type: "application/pdf",
  });
}
