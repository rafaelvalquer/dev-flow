import React from "react";
import { AUTOMATION_PRESETS } from "../automationTemplates";

export default function AutomationTemplates({ onPickTemplate }) {
  return (
    <div className="space-y-2">
      {AUTOMATION_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition hover:bg-zinc-50"
          onClick={() => onPickTemplate(p)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(
              "application/automation-template",
              JSON.stringify(p)
            );
            e.dataTransfer.effectAllowed = "copy";
          }}
        >
          <div className="font-semibold text-zinc-900">{p.title}</div>
          <div className="mt-0.5 text-[11px] text-zinc-600">
            {p.trigger.type} → {p.action.type}
          </div>
        </button>
      ))}
    </div>
  );
}
