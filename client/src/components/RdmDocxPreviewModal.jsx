// src/components/RdmDocxPreviewModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { renderAsync } from "docx-preview";
import { buildRdmDocxBlob, downloadDocxBlob } from "../utils/rdmDocx";

// docx-preview usa JSZip (em alguns builds ele espera estar no window) :contentReference[oaicite:2]{index=2}
if (typeof window !== "undefined" && !window.JSZip) {
  window.JSZip = JSZip;
}

export default function RdmDocxPreviewModal({
  open,
  onClose,
  rdm,
  filename = "RDM.docx",
}) {
  const bodyRef = useRef(null);
  const styleRef = useRef(null);

  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [blob, setBlob] = useState(null);

  const canDownload = !!blob && !status && !err;

  const snapshot = useMemo(() => rdm, [rdm]); // rdm já deve vir “congelado” do pai

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function run() {
      setErr("");
      setBlob(null);
      setStatus("Gerando DOCX…");

      if (bodyRef.current) bodyRef.current.innerHTML = "";
      if (styleRef.current) styleRef.current.innerHTML = "";

      try {
        const b = await buildRdmDocxBlob(snapshot);
        if (cancelled) return;

        setBlob(b);
        setStatus("Renderizando prévia…");

        const ab = await b.arrayBuffer();
        if (cancelled) return;

        // renderAsync(document, bodyContainer, styleContainer, options) :contentReference[oaicite:3]{index=3}
        await renderAsync(ab, bodyRef.current, styleRef.current, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
        });

        if (cancelled) return;
        setStatus("");
      } catch (e) {
        if (cancelled) return;
        setStatus("");
        setErr(e?.message ? String(e.message) : String(e));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [open, snapshot]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 100%)",
          height: "min(82vh, 900px)",
          background: "#fff",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid #e5e7eb",
            background: "#f8fafc",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            rowGap: 10,
          }}
        >
          <div
            style={{
              fontWeight: 800,
              color: "#0f172a",
              flex: "1 1 260px",
              minWidth: 0,
            }}
          >
            Preview final — DOCX
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flex: "0 0 auto",
              flexWrap: "wrap",
              justifyContent: "flex-end",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={() => blob && downloadDocxBlob(blob, filename)}
              disabled={!canDownload}
              style={{
                border: "1px solid #1d4ed8",
                background: canDownload ? "#1d4ed8" : "#cbd5e1",
                color: "#ffffff",
                borderRadius: 10,
                padding: "9px 12px",
                fontWeight: 800,
                cursor: canDownload ? "pointer" : "not-allowed",
                boxShadow: canDownload
                  ? "0 6px 16px rgba(29,78,216,0.18)"
                  : "none",
              }}
            >
              Baixar DOCX
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                border: "1px solid #e2e8f0",
                background: "#ffffff",
                color: "#0f172a", // ✅ força texto escuro (corrige o “invisível”)
                borderRadius: 10,
                padding: "9px 12px",
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 2px 10px rgba(2,6,23,0.06)",
              }}
            >
              Fechar
            </button>
          </div>
        </div>

        {/* Status / erro */}
        {(status || err) && (
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid #eee",
              background: err ? "#fff5f5" : "#f8fafc",
              color: err ? "#b91c1c" : "#0f172a",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {!err && (
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: "2px solid #94a3b8",
                  borderTopColor: "#0b57d0",
                  display: "inline-block",
                  animation: "spin 0.9s linear infinite",
                }}
              />
            )}
            <span>{err ? `Erro: ${err}` : status}</span>
          </div>
        )}

        {/* Body */}
        <div style={{ position: "relative", flex: 1, overflow: "auto" }}>
          {/* styles do docx-preview */}
          <div ref={styleRef} />

          {/* conteúdo renderizado */}
          <div ref={bodyRef} style={{ padding: 18 }} />
        </div>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg);} }
          /* melhora o wrapper padrão do docx-preview */
          .docx-wrapper { background: #f1f5f9; padding: 16px; }
          .docx { background: transparent; }
        `}</style>
      </div>
    </div>
  );
}
