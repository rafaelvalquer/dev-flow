import { Copy } from "lucide-react";
import { toast } from "sonner";

import {
  buildDailySummary,
  buildNextActions,
  buildRiskRows,
} from "../utils/developerRiskRules";
import { copyTextToClipboard } from "../utils/developerTicketUtils";

function DailySection({ title, items, renderItem }) {
  return (
    <section className="developer-daily__section">
      <h4>{title}</h4>
      {items.length ? (
        <div>
          {items.map(renderItem)}
        </div>
      ) : (
        <p>Sem itens.</p>
      )}
    </section>
  );
}

export function DailyWidget({ rows, onOpenExecution }) {
  const riskRows = buildRiskRows(rows, 4);
  const actions = buildNextActions(rows, 4);
  const summary = buildDailySummary(rows, riskRows, actions);
  const hasTickets = Boolean(rows?.length);

  async function copyDaily() {
    if (!hasTickets) return;

    try {
      const copied = await copyTextToClipboard(summary.text);
      if (!copied) throw new Error("Clipboard indisponível.");
      toast.success("Daily copiado.");
    } catch (err) {
      toast.error("Não foi possível copiar o daily.", {
        description: err?.message || String(err),
      });
    }
  }

  if (!hasTickets) {
    return (
      <div className="developer-daily">
        <div className="developer-empty-widget">Sem itens para o daily de hoje.</div>
        <button type="button" className="developer-daily__copy" disabled>
          <Copy className="h-4 w-4" />
          Copiar daily
        </button>
      </div>
    );
  }

  return (
    <div className="developer-daily">
      <DailySection
        title="Estou atuando em:"
        items={summary.active}
        renderItem={(item) => (
          <button
            type="button"
            key={item.key}
            className="developer-daily__item"
            onClick={() => onOpenExecution(item.key)}
          >
            <strong>{item.key}</strong>
            <span>{`— ${item.status} — ${item.progress}%`}</span>
          </button>
        )}
      />

      <DailySection
        title="Pendências:"
        items={summary.pending}
        renderItem={(item) => (
          <button
            type="button"
            key={`${item.key}:${item.label}`}
            className="developer-daily__item"
            onClick={() => onOpenExecution(item.key)}
          >
            <strong>{item.key}</strong>
            <span>{item.label}</span>
          </button>
        )}
      />

      <DailySection
        title="Riscos:"
        items={summary.risks}
        renderItem={(item) => (
          <button
            type="button"
            key={item.key}
            className="developer-daily__item"
            onClick={() => onOpenExecution(item.key)}
          >
            <strong>{item.key}</strong>
            <span>{item.text.replace(`${item.key} `, "")}</span>
          </button>
        )}
      />

      <button type="button" className="developer-daily__copy" onClick={copyDaily}>
        <Copy className="h-4 w-4" />
        Copiar daily
      </button>
    </div>
  );
}
