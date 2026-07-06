import React from "react";
import { FileUp, Music, Package } from "lucide-react";

function FileField({ label, icon: Icon, accept, multiple, onChange }) {
  return (
    <label className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 transition hover:border-red-200 hover:bg-red-50">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-red-600">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <span className="block text-sm font-semibold text-zinc-900">{label}</span>
          <span className="text-xs text-zinc-500">{multiple ? "Múltiplos arquivos" : "Arquivo único"}</span>
        </div>
      </div>
      <input
        className="mt-3 block w-full text-sm text-zinc-600"
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => onChange(event.target.files)}
      />
    </label>
  );
}

export default function UraUploadPanel({
  projectName,
  onProjectNameChange,
  niceFile,
  onNiceFileChange,
  audioFiles,
  onAudioFilesChange,
  audioZip,
  onAudioZipChange,
  onSubmit,
  submitting,
  disabled,
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="min-w-[260px] flex-1">
          <span className="text-sm font-semibold text-zinc-900">Nome do projeto</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={projectName}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder="URA_ALO_RH"
          />
        </label>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !niceFile || disabled}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {submitting ? "Enviando..." : "Gerar documentação"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <FileField
          label={niceFile ? niceFile.name : "Arquivo NICE"}
          icon={FileUp}
          accept=".xml,.txt,.json"
          onChange={(files) => onNiceFileChange(files?.[0] || null)}
        />
        <FileField
          label={`${audioFiles?.length || 0} WAV(s) selecionado(s)`}
          icon={Music}
          accept=".wav,audio/wav"
          multiple
          onChange={(files) => onAudioFilesChange(Array.from(files || []))}
        />
        <FileField
          label={audioZip ? audioZip.name : "ZIP de áudios"}
          icon={Package}
          accept=".zip,application/zip"
          onChange={(files) => onAudioZipChange(files?.[0] || null)}
        />
      </div>
    </section>
  );
}
