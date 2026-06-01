import React, { useEffect, useState } from "react";
import { ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { jiraIssuePicker } from "@/lib/jiraClient";

function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs, value]);

  return debounced;
}

export default function JiraTicketPicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!open) return;
      const q = String(debouncedQuery || "").trim();
      if (q.length < 2) {
        setOptions([]);
        return;
      }

      setLoading(true);
      try {
        const data = await jiraIssuePicker({ query: q });
        if (!alive) return;
        const sections = Array.isArray(data?.sections) ? data.sections : [];
        const issues = sections.flatMap((section) =>
          Array.isArray(section?.issues) ? section.issues : [],
        );
        setOptions(
          issues
            .map((issue) => ({
              key: issue?.key || issue?.keyHtml?.replace(/<[^>]+>/g, "") || "",
              summary: issue?.summaryText || issue?.summary || "",
            }))
            .filter((issue) => issue.key),
        );
      } catch {
        if (alive) setOptions([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [debouncedQuery, open]);

  function applyManualValue() {
    const typed = String(query || "").trim().toUpperCase();
    if (!typed) return;
    const issue = { key: typed, summary: "" };
    setSelected(issue);
    onChange(typed);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-10 w-full justify-between rounded-xl border-zinc-200 bg-white text-left text-sm hover:bg-zinc-50"
        >
          <span className="min-w-0 truncate">
            {selected?.key || value || "Selecionar ticket Jira"}
          </span>
          {loading ? (
            <Loader2 className="ml-2 h-4 w-4 animate-spin text-zinc-500" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 text-zinc-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] max-w-[calc(100vw-3rem)] rounded-2xl border-zinc-200 p-2">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Buscar ou colar a chave do ticket..."
          />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>
              {loading
                ? "Buscando..."
                : String(query || "").trim().length < 2
                  ? "Digite 2 ou mais caracteres."
                  : "Nenhum ticket encontrado."}
            </CommandEmpty>
            <CommandGroup>
              {String(query || "").trim() ? (
                <CommandItem
                  value={`manual-${query}`}
                  onSelect={applyManualValue}
                  className="rounded-xl"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900">
                      Usar "{String(query || "").trim().toUpperCase()}"
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      Para quando voce ja sabe a chave do ticket.
                    </div>
                  </div>
                </CommandItem>
              ) : null}
              {options.map((issue) => (
                <CommandItem
                  key={issue.key}
                  value={`${issue.key} ${issue.summary}`}
                  onSelect={() => {
                    setSelected(issue);
                    onChange(issue.key);
                    setOpen(false);
                  }}
                  className="rounded-xl"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900">
                      {issue.key}
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {issue.summary || "-"}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
