import { useState } from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { normalizeTicketKey } from "../utils/developerTicketUtils";

const NOTE_COLORS = [
  { value: "yellow", label: "Amarelo" },
  { value: "blue", label: "Azul" },
  { value: "green", label: "Verde" },
  { value: "pink", label: "Rosa" },
  { value: "purple", label: "Roxo" },
];

export function NotesWidget({
  noteTickets,
  noteTicketKey,
  setNoteTicketKey,
  notesDraft,
  setNotesDraft,
  onSave,
  onShowAll,
  saving,
}) {
  const [draftTitle, setDraftTitle] = useState("");
  const [draftColor, setDraftColor] = useState("yellow");
  const isFreeNote = noteTicketKey === "__free__";
  const key = isFreeNote ? "" : normalizeTicketKey(noteTicketKey || noteTickets[0]);
  const draftKey = isFreeNote || !key ? "__free__" : key;
  const text = notesDraft?.[draftKey]?.text ?? notesDraft?.[draftKey] ?? "";

  return (
    <div className="developer-notes">
      <select
        value={isFreeNote ? "__free__" : key}
        onChange={(event) => setNoteTicketKey(event.target.value)}
      >
        <option value="__free__">Sem ticket</option>
        {noteTickets.length ? (
          noteTickets.map((ticketKey) => (
            <option key={ticketKey} value={ticketKey}>
              {ticketKey}
            </option>
          ))
        ) : null}
      </select>
      {isFreeNote || !key ? (
        <Input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          placeholder="Titulo da nota livre"
        />
      ) : null}
      <Textarea
        value={text}
        onChange={(event) =>
          setNotesDraft((prev) => ({
            ...prev,
            [draftKey]: event.target.value,
          }))
        }
        placeholder="Minhas notas privadas..."
      />
      <div className="developer-note-colors" aria-label="Cor do post-it">
        {NOTE_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            className={cn(
              "developer-note-color",
              `developer-note-color--${color.value}`,
              draftColor === color.value && "is-selected",
            )}
            onClick={() => setDraftColor(color.value)}
            title={color.label}
            aria-label={color.label}
          />
        ))}
      </div>
      <Button
        type="button"
        className="rounded-xl bg-red-600 text-white hover:bg-red-700"
        onClick={() =>
          onSave({
            ticketKey: key,
            title: isFreeNote || !key ? draftTitle : "",
            color: draftColor,
            draftKey,
            onCreated: () => {
              if (!key) setDraftTitle("");
            },
          })
        }
        disabled={saving}
      >
        <Save className="mr-2 h-4 w-4" />
        Criar post-it
      </Button>
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todas as notas
      </button>
    </div>
  );
}
