import { CloudUpload, Copy, Grid2X2, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";

export function QuickActionsWidget({ onAction }) {
  return (
    <div className="developer-quick-actions">
      <QuickAction icon={Grid2X2} label="Abrir Jira" tone="blue" onClick={() => onAction("jira")} />
      <QuickAction icon={MessageSquare} label="Criar comentário" tone="red" onClick={() => onAction("comment")} />
      <QuickAction icon={CloudUpload} label="Subir evidência" tone="blue" onClick={() => onAction("evidence")} />
      <QuickAction icon={Copy} label="Copiar status daily" tone="red" onClick={() => onAction("daily")} />
    </div>
  );
}

export function QuickAction({ icon: Icon, label, tone, onClick }) {
  return (
    <button type="button" className={cn("developer-quick-action", `developer-quick-action--${tone}`)} onClick={onClick}>
      <Icon className="h-6 w-6" />
      <span>{label}</span>
    </button>
  );
}
