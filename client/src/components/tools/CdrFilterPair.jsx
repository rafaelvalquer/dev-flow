import React from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function FieldLabel({ children }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </span>
  );
}

export default function CdrFilterPair({
  index,
  filters,
  fields,
  disabled = false,
  onChange,
}) {
  const fieldKey = `campo${index}`;
  const valueKey = `valor${index}`;
  const selectedField = filters[fieldKey] || "0";

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm shadow-zinc-950/[0.03]">
      <label className="grid min-w-0 gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>{`Campo ${index}`}</FieldLabel>
          {selectedField !== "0" ? (
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" aria-hidden="true" />
          ) : null}
        </div>
        <Select
          value={selectedField}
          onValueChange={(value) => onChange(fieldKey, value)}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 rounded-lg px-3 text-sm">
            <SelectValue placeholder="Campo" />
          </SelectTrigger>
          <SelectContent className="max-h-72 overflow-y-auto">
            {(fields || []).map((field) => (
              <SelectItem key={`${index}-${field.value}`} value={field.value}>
                {field.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="grid min-w-0 gap-1.5">
        <span className="sr-only">{`Valor ${index}`}</span>
        <Input
          value={filters[valueKey] || ""}
          onChange={(event) => onChange(valueKey, event.target.value)}
          disabled={disabled || selectedField === "0"}
          placeholder={selectedField === "0" ? "Selecione um campo" : "Valor do filtro"}
          className="h-9 rounded-lg px-3 text-sm"
        />
      </label>
    </div>
  );
}
