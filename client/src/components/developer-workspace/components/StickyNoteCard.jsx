import { forwardRef, useEffect, useState } from "react";
import {
  Check,
  Edit3,
  Grip,
  MessageSquare,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtDateTimeShort, normalizeTicketKey } from "../utils/developerTicketUtils";

const NOTE_COLORS = ["yellow", "blue", "green", "pink", "purple"];

export const StickyNoteCard = forwardRef(function StickyNoteCard(
  {
    note,
    focused,
    saving,
    onUpdate,
    onTogglePinned,
    onToggleResolved,
    onConvertToJiraComment,
    onDelete,
  },
  ref,
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: note?.title || "",
    text: note?.text || "",
    color: note?.color || "yellow",
  });
  const text = String(note?.text || "").trim();
  const updated = fmtDateTimeShort(note?.updatedAt || note?.createdAt);
  const ticketKey = normalizeTicketKey(note?.ticketKey);
  const color = NOTE_COLORS.includes(note?.color) ? note.color : "yellow";

  useEffect(() => {
    if (editing) return;
    setDraft({
      title: note?.title || "",
      text: note?.text || "",
      color: NOTE_COLORS.includes(note?.color) ? note.color : "yellow",
    });
  }, [editing, note]);

  function cancelEdit() {
    setDraft({
      title: note?.title || "",
      text: note?.text || "",
      color,
    });
    setEditing(false);
  }

  async function saveEdit() {
    await onUpdate?.(note.id, {
      title: draft.title,
      text: draft.text,
      color: draft.color,
    });
    setEditing(false);
  }

  return (
    <article
      ref={ref}
      tabIndex={-1}
      className={cn(
        "developer-sticky-note",
        `developer-sticky-note--${color}`,
        focused && "developer-sticky-note--focused",
        note?.pinned && "developer-sticky-note--pinned",
        note?.resolved && "developer-sticky-note--resolved",
      )}
    >
      <div className="developer-sticky-note__drag" title="Mover post-it">
        <Grip className="h-4 w-4" />
      </div>
      <div className="developer-sticky-note__actions">
        <button
          type="button"
          onClick={onTogglePinned}
          disabled={saving}
          title={note?.pinned ? "Desafixar post-it" : "Fixar post-it"}
          aria-label={note?.pinned ? "Desafixar post-it" : "Fixar post-it"}
        >
          {note?.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={saving || editing}
          title="Editar post-it"
          aria-label="Editar post-it"
        >
          <Edit3 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleResolved}
          disabled={saving}
          title={note?.resolved ? "Reabrir nota" : "Marcar como resolvida"}
          aria-label={note?.resolved ? "Reabrir nota" : "Marcar como resolvida"}
        >
          {note?.resolved ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        </button>
        {ticketKey ? (
          <button
            type="button"
            onClick={onConvertToJiraComment}
            disabled={saving}
            title="Comentar no Jira"
            aria-label="Comentar no Jira"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          className="developer-sticky-note__delete"
          onClick={onDelete}
          disabled={saving}
          title="Excluir post-it"
          aria-label={`Excluir post-it ${ticketKey || ""}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="developer-sticky-note__pin" aria-hidden="true" />

      {editing ? (
        <div className="developer-sticky-note__editor">
          <Input
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Titulo"
          />
          <Textarea
            value={draft.text}
            onChange={(event) => setDraft((prev) => ({ ...prev, text: event.target.value }))}
            placeholder="Texto da nota"
          />
          <div className="developer-note-colors">
            {NOTE_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                className={cn(
                  "developer-note-color",
                  `developer-note-color--${item}`,
                  draft.color === item && "is-selected",
                )}
                onClick={() => setDraft((prev) => ({ ...prev, color: item }))}
                aria-label={`Cor ${item}`}
              />
            ))}
          </div>
          <div className="developer-sticky-note__editor-actions">
            <button type="button" onClick={saveEdit} disabled={saving || !draft.text.trim()}>
              Salvar
            </button>
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="developer-sticky-note__ticket">
            {ticketKey || "Nota livre"}
          </div>
          <h3>{note?.title || ticketKey || "Nota livre"}</h3>
          <p>{text}</p>
          <footer>
            <span>{note?.resolved ? "Resolvida" : "Nota privada"}</span>
            {note?.jiraCommentedAt ? <span>Enviada ao Jira</span> : null}
            {updated ? <time dateTime={note?.updatedAt || note?.createdAt}>{updated}</time> : null}
          </footer>
        </>
      )}
    </article>
  );
});
