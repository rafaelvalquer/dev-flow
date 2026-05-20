import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  jiraCreateIssue,
  jiraCreateIssueLink,
  jiraGetCreateIssueFields,
  jiraGetCreateIssueTypes,
  jiraGetProjectStatuses,
  jiraIssuePicker,
  jiraListIssueLinkTypes,
  jiraSearchJqlAll,
  jiraSearchProjects,
  jiraSearchUsers,
  jiraTransitionToStatus,
  jiraUploadIssueAttachments,
} from "../lib/jiraClient";

const DEFAULT_PROJECT_KEY = "ICON";
const EMPTY = "__empty__";

const SECTION_TITLES = {
  classification: "Classificacao",
  peopleDates: "Pessoas e datas",
  details: "Detalhes",
  others: "Outros campos do Jira",
};

const RESERVED_FIELD_IDS = new Set([
  "project",
  "issuetype",
  "summary",
  "description",
  "parent",
  "status",
  "attachment",
]);

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "?";
}

function makeAdf(text) {
  const value = String(text || "").trim();
  return {
    type: "doc",
    version: 1,
    content: value
      ? value.split(/\n{2,}/).map((paragraph) => ({
          type: "paragraph",
          content: [{ type: "text", text: paragraph }],
        }))
      : [],
  };
}

function escapeJqlText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quoteJqlName(value) {
  return `"${escapeJqlText(value)}"`;
}

function getFieldId(field) {
  return field?.fieldId || field?.key || field?.id || "";
}

function getFieldName(field) {
  return field?.name || field?.fieldName || getFieldId(field);
}

function toFieldList(meta) {
  const fields = meta?.fields;
  if (Array.isArray(fields)) return fields.filter(Boolean);
  if (fields && typeof fields === "object") {
    return Object.entries(fields).map(([id, field]) => ({
      fieldId: field?.fieldId || id,
      ...field,
    }));
  }
  return [];
}

function allowedValues(field) {
  return Array.isArray(field?.allowedValues) ? field.allowedValues : [];
}

function optionId(option) {
  return String(
    option?.id ||
      option?.accountId ||
      option?.key ||
      option?.value ||
      option?.name ||
      "",
  );
}

function optionLabel(option) {
  return String(
    option?.displayName ||
      option?.value ||
      option?.name ||
      option?.key ||
      option?.id ||
      "",
  );
}

function flattenAllowedValues(field) {
  const flat = [];
  allowedValues(field).forEach((option) => {
    const id = optionId(option);
    if (id) {
      flat.push({
        value: id,
        label: optionLabel(option),
        option,
      });
    }
    const children = Array.isArray(option?.children) ? option.children : [];
    children.forEach((child) => {
      const childId = optionId(child);
      if (!id || !childId) return;
      flat.push({
        value: `${id}::${childId}`,
        label: `${optionLabel(option)} / ${optionLabel(child)}`,
        option,
        child,
      });
    });
  });
  return flat;
}

function isFieldRequired(field) {
  return Boolean(field?.required);
}

function defaultValueForField(field) {
  const value = field?.defaultValue;
  if (value == null) return "";

  const schema = field?.schema || {};
  if (schema.type === "array" && Array.isArray(value)) {
    return value.map(optionId).filter(Boolean);
  }
  if (schema.type === "user") return value?.accountId || "";
  if (schema.type === "date" || schema.type === "datetime") {
    return String(value?.value || value || "").slice(0, schema.type === "date" ? 10 : 16);
  }
  if (typeof value === "object") return optionId(value) || optionLabel(value);
  return String(value);
}

function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  return String(value || "").trim() === "";
}

function fieldKind(field) {
  const id = getFieldId(field);
  const name = normalizeText(getFieldName(field));
  const schema = field?.schema || {};
  const custom = String(schema.custom || "").toLowerCase();

  if (id === "parent") return "issue";
  if (schema.type === "user") return "user";
  if (schema.type === "date") return "date";
  if (schema.type === "datetime") return "datetime";
  if (schema.type === "number") return "number";
  if (id === "labels") return "labels";
  if (schema.type === "array" && allowedValues(field).length) return "multi-select";
  if (allowedValues(field).length) return "select";
  if (schema.type === "array") return "csv";
  if (schema.type === "any" || custom.includes("textarea") || /descricao|criterio|informacoes|historico/.test(name)) {
    return "textarea";
  }
  return "text";
}

function sectionForField(field) {
  const id = getFieldId(field);
  const name = normalizeText(getFieldName(field));
  if (
    id === "priority" ||
    id === "components" ||
    id === "fixVersions" ||
    /diretoria|subcategoria|team|release|tamanho|classificacao|classes de servico|categoria|frente|quadro|areas envolvidas|parceiro|fornecedor/.test(
      name,
    )
  ) {
    return "classification";
  }
  if (
    id === "reporter" ||
    id === "assignee" ||
    id === "duedate" ||
    /relator|responsavel|solicitante|condutor|facilitador|lider tecnico|area demandante|data|start date/.test(
      name,
    )
  ) {
    return "peopleDates";
  }
  if (/criterio|aceite|informacoes adicionais|historico de tempo/.test(name)) {
    return "details";
  }
  return "others";
}

function formatOptionValue(field, rawValue) {
  if (!rawValue) return null;
  const [parentId, childId] = String(rawValue).split("::");
  if (childId) return { id: parentId, child: { id: childId } };
  const match = flattenAllowedValues(field).find((item) => item.value === rawValue);
  const option = match?.option || allowedValues(field).find((item) => optionId(item) === rawValue);
  if (option?.accountId) return { accountId: option.accountId };
  if (option?.key && !option?.id) return { key: option.key };
  if (option?.value && !option?.id) return { value: option.value };
  return { id: rawValue };
}

function formatFieldValue(field, value) {
  const id = getFieldId(field);
  const schema = field?.schema || {};
  const kind = fieldKind(field);

  if (isEmptyValue(value)) return undefined;
  if (id === "parent") return { key: String(value).trim().toUpperCase() };
  if (kind === "user") return { accountId: String(value).trim() };
  if (kind === "date") return String(value).slice(0, 10);
  if (kind === "datetime") return new Date(value).toISOString();
  if (kind === "number") return Number(value);
  if (kind === "labels") {
    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (kind === "csv") {
    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (kind === "textarea") {
    if (schema.type === "any" || String(schema.custom || "").includes("textarea")) {
      return makeAdf(value);
    }
    return String(value);
  }
  if (kind === "multi-select") {
    return (Array.isArray(value) ? value : [value])
      .map((item) => formatOptionValue(field, item))
      .filter(Boolean);
  }
  if (kind === "select") return formatOptionValue(field, value);
  return String(value);
}

function fieldErrorFor(fieldErrors, field) {
  const id = getFieldId(field);
  return fieldErrors?.[id] || fieldErrors?.[getFieldName(field)] || "";
}

function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}

function UserPickerField({ value, onChange, disabled, placeholder = "Buscar usuario..." }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);

  useEffect(() => {
    let alive = true;
    async function run() {
      const q = String(debouncedQuery || "").trim();
      if (!open || q.length < 2) {
        setOptions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const list = await jiraSearchUsers(q);
        if (!alive) return;
        setOptions(
          (Array.isArray(list) ? list : []).filter((user) => user?.accountId),
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

  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);

  const label = selected?.displayName || (value ? "Usuario selecionado" : "Selecionar");
  const avatar = selected?.avatarUrls?.["48x48"] || selected?.avatarUrls?.["32x32"] || "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-10 w-full justify-between rounded-xl border-zinc-200 bg-white text-sm text-zinc-900 hover:bg-zinc-50"
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {selected ? (
              <Avatar className="h-6 w-6 border border-zinc-200">
                {avatar ? <AvatarImage src={avatar} alt="" /> : null}
                <AvatarFallback className="bg-zinc-100 text-[10px]">
                  {initials(selected.displayName)}
                </AvatarFallback>
              </Avatar>
            ) : null}
            <span className="truncate">{label}</span>
          </span>
          {loading ? (
            <Loader2 className="ml-2 h-4 w-4 animate-spin text-zinc-500" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 text-zinc-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] max-w-[calc(100vw-3rem)] rounded-2xl border-zinc-200 p-2">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>
              {loading
                ? "Buscando..."
                : String(query || "").trim().length < 2
                  ? "Digite 2 ou mais caracteres."
                  : "Nenhum usuario encontrado."}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  setSelected(null);
                  onChange("");
                  setOpen(false);
                }}
                className="rounded-xl"
              >
                Sem usuario
              </CommandItem>
              {options.map((user) => {
                const avatarUrl =
                  user?.avatarUrls?.["48x48"] || user?.avatarUrls?.["32x32"] || "";
                const isSelected = value === user.accountId;
                return (
                  <CommandItem
                    key={user.accountId}
                    value={user.displayName}
                    onSelect={() => {
                      setSelected(user);
                      onChange(user.accountId);
                      setOpen(false);
                    }}
                    className="rounded-xl"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Avatar className="h-7 w-7 border border-zinc-200">
                        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
                        <AvatarFallback className="bg-zinc-100 text-[10px]">
                          {initials(user.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {user.displayName}
                        </div>
                        {user.emailAddress ? (
                          <div className="truncate text-[11px] text-zinc-500">
                            {user.emailAddress}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {isSelected ? <Check className="h-4 w-4 text-emerald-600" /> : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function IssuePickerField({
  value,
  onChange,
  projectKey,
  jql,
  disabled,
  placeholder = "Buscar ticket...",
}) {
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
      if (q.length < 2 && !jql) {
        setOptions([]);
        return;
      }
      setLoading(true);
      try {
        if (q.length < 2 && jql) {
          const issues = await jiraSearchJqlAll({
            jql,
            maxResults: 20,
            fields: ["summary", "issuetype", "status"],
          });
          if (!alive) return;
          setOptions(
            (Array.isArray(issues) ? issues : []).map((issue) => ({
              key: issue?.key || "",
              summary: issue?.fields?.summary || "",
            })),
          );
          return;
        }

        const data = await jiraIssuePicker({
          query: q,
          currentJQL: jql || (projectKey ? `project = ${projectKey}` : ""),
        });
        if (!alive) return;
        const sections = Array.isArray(data?.sections) ? data.sections : [];
        const issues = sections.flatMap((section) =>
          Array.isArray(section?.issues) ? section.issues : [],
        );
        setOptions(
          issues.map((issue) => ({
            key: issue?.key || issue?.keyHtml?.replace(/<[^>]+>/g, "") || "",
            summary: issue?.summaryText || issue?.summary || "",
          })),
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
  }, [debouncedQuery, jql, open, projectKey]);

  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);

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
            {selected?.key || value || "Selecionar ticket"}
          </span>
          {loading ? (
            <Loader2 className="ml-2 h-4 w-4 animate-spin text-zinc-500" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 text-zinc-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[480px] max-w-[calc(100vw-3rem)] rounded-2xl border-zinc-200 p-2">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>
              {loading
                ? "Buscando..."
                : String(query || "").trim().length < 2
                  ? "Digite 2 ou mais caracteres."
                  : "Nenhum ticket encontrado."}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  setSelected(null);
                  onChange("");
                  setOpen(false);
                }}
                className="rounded-xl"
              >
                Sem ticket
              </CommandItem>
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

function FieldShell({ field, error, children }) {
  const required = isFieldRequired(field);
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center gap-1 text-xs font-semibold text-zinc-700">
        {getFieldName(field)}
        {required ? <span className="text-red-600">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function GenericField({
  field,
  value,
  onChange,
  disabled,
  fieldErrors,
  projectKey,
  parentJql,
}) {
  const kind = fieldKind(field);
  const id = getFieldId(field);
  const error = fieldErrorFor(fieldErrors, field);
  const options = flattenAllowedValues(field);

  if (kind === "user") {
    return (
      <FieldShell field={field} error={error}>
        <UserPickerField value={value || ""} onChange={onChange} disabled={disabled} />
      </FieldShell>
    );
  }

  if (kind === "issue") {
    return (
      <FieldShell field={field} error={error}>
        <IssuePickerField
          value={value || ""}
          onChange={onChange}
          disabled={disabled}
          projectKey={projectKey}
          jql={parentJql}
          placeholder="Buscar pai..."
        />
      </FieldShell>
    );
  }

  if (kind === "select") {
    return (
      <FieldShell field={field} error={error}>
        <select
          value={value || EMPTY}
          onChange={(event) =>
            onChange(event.target.value === EMPTY ? "" : event.target.value)
          }
          disabled={disabled}
          className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value={EMPTY}>Selecionar</option>
          {options.map((option) => (
            <option key={`${id}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }

  if (kind === "multi-select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <FieldShell field={field} error={error}>
        <select
          multiple
          value={selected}
          onChange={(event) =>
            onChange(
              Array.from(event.target.selectedOptions).map((option) => option.value),
            )
          }
          disabled={disabled}
          className="min-h-[112px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500"
        >
          {options.map((option) => (
            <option key={`${id}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }

  if (kind === "textarea") {
    return (
      <FieldShell field={field} error={error}>
        <Textarea
          value={value || ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={5}
          className="rounded-xl border-zinc-200 bg-white"
        />
      </FieldShell>
    );
  }

  const type = kind === "date" ? "date" : kind === "datetime" ? "datetime-local" : kind === "number" ? "number" : "text";
  return (
    <FieldShell field={field} error={error}>
      <Input
        type={type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={kind === "labels" || kind === "csv" ? "Separe por virgula" : ""}
        className="rounded-xl border-zinc-200 bg-white"
      />
    </FieldShell>
  );
}

function groupFields(fields) {
  const groups = {
    classification: [],
    peopleDates: [],
    details: [],
    others: [],
  };

  fields.forEach((field) => {
    const id = getFieldId(field);
    if (!id || RESERVED_FIELD_IDS.has(id)) return;
    groups[sectionForField(field)].push(field);
  });

  return groups;
}

function payloadFromForm({ project, issueType, fields, values, summary, description, parentKey }) {
  const payloadFields = {
    project: project?.id ? { id: String(project.id) } : { key: project?.key },
    issuetype: { id: String(issueType?.id || "") },
    summary: String(summary || "").trim(),
  };

  if (String(description || "").trim()) {
    payloadFields.description = makeAdf(description);
  }
  if (parentKey) {
    payloadFields.parent = { key: String(parentKey).trim().toUpperCase() };
  }

  fields.forEach((field) => {
    const id = getFieldId(field);
    if (!id || RESERVED_FIELD_IDS.has(id)) return;
    const formatted = formatFieldValue(field, values[id]);
    if (formatted !== undefined) payloadFields[id] = formatted;
  });

  return { fields: payloadFields };
}

function getInitialStatus(statuses, issueType) {
  const selected = statuses.find(
    (item) =>
      String(item?.id || "") === String(issueType?.id || "") ||
      normalizeText(item?.name) === normalizeText(issueType?.name),
  );
  const list = Array.isArray(selected?.statuses) ? selected.statuses : [];
  return list[0]?.name || "";
}

function getStatusesForType(statuses, issueType) {
  const selected = statuses.find(
    (item) =>
      String(item?.id || "") === String(issueType?.id || "") ||
      normalizeText(item?.name) === normalizeText(issueType?.name),
  );
  return Array.isArray(selected?.statuses) ? selected.statuses : [];
}

function parentTypesFor(issueTypes, issueType) {
  const selectedLevel = Number(issueType?.hierarchyLevel ?? 0);
  const candidates = (issueTypes || []).filter(
    (type) => Number(type?.hierarchyLevel ?? 0) > selectedLevel,
  );
  if (candidates.length) return candidates;
  if (/historia|story/.test(normalizeText(issueType?.name))) {
    return (issueTypes || []).filter((type) => /epic|epico/.test(normalizeText(type?.name)));
  }
  return [];
}

function projectDisplay(project) {
  if (!project) return "";
  return `${project.key || project.id || ""} - ${project.name || ""}`.trim();
}

function issueTypeDisplay(type) {
  return type?.name || type?.id || "";
}

export default function CreateJiraIssueDialog({ open, onOpenChange, onCreated }) {
  const [projects, setProjects] = useState([]);
  const [issueTypes, setIssueTypes] = useState([]);
  const [fieldsMeta, setFieldsMeta] = useState(null);
  const [projectStatuses, setProjectStatuses] = useState([]);
  const [issueLinkTypes, setIssueLinkTypes] = useState([]);

  const [projectId, setProjectId] = useState("");
  const [issueTypeId, setIssueTypeId] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [desiredStatus, setDesiredStatus] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [fieldValues, setFieldValues] = useState({});
  const [attachments, setAttachments] = useState([]);
  const [links, setLinks] = useState([]);

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const fileRef = useRef(null);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === projectId) || null,
    [projectId, projects],
  );
  const selectedIssueType = useMemo(
    () => issueTypes.find((type) => String(type.id) === issueTypeId) || null,
    [issueTypeId, issueTypes],
  );
  const fields = useMemo(() => toFieldList(fieldsMeta), [fieldsMeta]);
  const grouped = useMemo(() => groupFields(fields), [fields]);
  const statusesForType = useMemo(
    () => getStatusesForType(projectStatuses, selectedIssueType),
    [projectStatuses, selectedIssueType],
  );
  const initialStatus = useMemo(
    () => getInitialStatus(projectStatuses, selectedIssueType),
    [projectStatuses, selectedIssueType],
  );
  const parentTypes = useMemo(
    () => parentTypesFor(issueTypes, selectedIssueType),
    [issueTypes, selectedIssueType],
  );
  const parentJql = useMemo(() => {
    if (!selectedProject?.key) return "";
    const typeNames = parentTypes.map((type) => type.name).filter(Boolean);
    if (!typeNames.length) return `project = ${selectedProject.key}`;
    return `project = ${selectedProject.key} AND issuetype in (${typeNames
      .map(quoteJqlName)
      .join(", ")}) ORDER BY updated DESC`;
  }, [parentTypes, selectedProject?.key]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function load() {
      setLoadingProjects(true);
      setErr("");
      try {
        const [projectResp, linkResp] = await Promise.all([
          jiraSearchProjects({ maxResults: 100 }),
          jiraListIssueLinkTypes().catch(() => null),
        ]);
        if (!alive) return;
        const list = Array.isArray(projectResp?.values) ? projectResp.values : [];
        setProjects(list);
        setIssueLinkTypes(Array.isArray(linkResp?.issueLinkTypes) ? linkResp.issueLinkTypes : []);
        const iconProject =
          list.find((project) => project.key === DEFAULT_PROJECT_KEY) ||
          list.find((project) =>
            normalizeText(project.name).includes("infra call center"),
          ) ||
          list[0];
        setProjectId(iconProject?.id ? String(iconProject.id) : "");
      } catch (error) {
        if (alive) setErr(error?.message || "Falha ao carregar projetos do Jira.");
      } finally {
        if (alive) setLoadingProjects(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !selectedProject) return;
    let alive = true;
    async function load() {
      setLoadingMeta(true);
      setIssueTypes([]);
      setIssueTypeId("");
      setFieldsMeta(null);
      setProjectStatuses([]);
      setFieldValues({});
      setParentKey("");
      setDesiredStatus("");
      try {
        const [typesResp, statusesResp] = await Promise.all([
          jiraGetCreateIssueTypes(selectedProject.key || selectedProject.id),
          jiraGetProjectStatuses(selectedProject.key || selectedProject.id).catch(() => []),
        ]);
        if (!alive) return;
        const list = Array.isArray(typesResp?.issueTypes) ? typesResp.issueTypes : [];
        setIssueTypes(list);
        setProjectStatuses(Array.isArray(statusesResp) ? statusesResp : []);
        const story =
          list.find((type) => /historia|story/.test(normalizeText(type.name))) ||
          list.find((type) => !type?.subtask) ||
          list[0];
        setIssueTypeId(story?.id ? String(story.id) : "");
      } catch (error) {
        if (alive) setErr(error?.message || "Falha ao carregar tipos de ticket.");
      } finally {
        if (alive) setLoadingMeta(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [open, selectedProject]);

  useEffect(() => {
    if (!open || !selectedProject || !selectedIssueType) return;
    let alive = true;
    async function load() {
      setLoadingMeta(true);
      setFieldsMeta(null);
      setFieldValues({});
      setParentKey("");
      setFieldErrors({});
      try {
        const meta = await jiraGetCreateIssueFields(
          selectedProject.key || selectedProject.id,
          selectedIssueType.id,
        );
        if (!alive) return;
        setFieldsMeta(meta);
        const initialValues = {};
        toFieldList(meta).forEach((field) => {
          const id = getFieldId(field);
          if (!id || RESERVED_FIELD_IDS.has(id)) return;
          const value = defaultValueForField(field);
          if (!isEmptyValue(value)) initialValues[id] = value;
        });
        setFieldValues(initialValues);
      } catch (error) {
        if (alive) setErr(error?.message || "Falha ao carregar campos do Jira.");
      } finally {
        if (alive) setLoadingMeta(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [open, selectedIssueType, selectedProject]);

  useEffect(() => {
    if (!initialStatus) return;
    setDesiredStatus((prev) => prev || initialStatus);
  }, [initialStatus]);

  function setFieldValue(fieldId, value) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    setFieldErrors((prev) => {
      if (!prev?.[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }

  function addLinkRow() {
    const defaultType =
      issueLinkTypes.find((type) => /relates/i.test(type?.name || "")) ||
      issueLinkTypes[0];
    setLinks((prev) => [
      ...prev,
      { id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, typeId: defaultType?.id || "", key: "" },
    ]);
  }

  function updateLinkRow(id, patch) {
    setLinks((prev) => prev.map((link) => (link.id === id ? { ...link, ...patch } : link)));
  }

  function removeLinkRow(id) {
    setLinks((prev) => prev.filter((link) => link.id !== id));
  }

  function validateRequired() {
    const errors = {};
    if (!selectedProject) errors.project = "Selecione um espaco.";
    if (!selectedIssueType) errors.issuetype = "Selecione o tipo do ticket.";
    if (!String(summary || "").trim()) errors.summary = "Resumo e obrigatorio.";

    fields.forEach((field) => {
      const id = getFieldId(field);
      if (!id || RESERVED_FIELD_IDS.has(id) || !isFieldRequired(field)) return;
      if (isEmptyValue(fieldValues[id]) && isEmptyValue(defaultValueForField(field))) {
        errors[id] = `${getFieldName(field)} e obrigatorio.`;
      }
    });

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit() {
    if (!validateRequired()) {
      setErr("Preencha os campos obrigatorios antes de criar.");
      return;
    }

    setSaving(true);
    setErr("");
    setFieldErrors({});

    try {
      const payload = payloadFromForm({
        project: selectedProject,
        issueType: selectedIssueType,
        fields,
        values: fieldValues,
        summary,
        description,
        parentKey,
      });

      const created = await jiraCreateIssue(payload);
      const issueKey = created?.key || created?.id || "";
      if (!issueKey) throw new Error("Jira criou o ticket, mas nao retornou a key.");

      const warnings = [];

      if (attachments.length) {
        try {
          await jiraUploadIssueAttachments(issueKey, attachments);
        } catch (error) {
          warnings.push(`Anexos: ${error?.message || "falha ao enviar"}`);
        }
      }

      const validLinks = links.filter((link) => link.typeId && link.key);
      for (const link of validLinks) {
        try {
          await jiraCreateIssueLink({
            type: { id: String(link.typeId) },
            outwardIssue: { key: issueKey },
            inwardIssue: { key: String(link.key).trim().toUpperCase() },
          });
        } catch (error) {
          warnings.push(`Vinculo ${link.key}: ${error?.message || "falha"}`);
        }
      }

      if (
        desiredStatus &&
        normalizeText(desiredStatus) !== normalizeText(initialStatus)
      ) {
        try {
          await jiraTransitionToStatus(issueKey, desiredStatus);
        } catch (error) {
          warnings.push(
            `Status: nao foi possivel mover para ${desiredStatus} (${error?.message || "sem transicao"})`,
          );
        }
      }

      if (warnings.length) {
        toast.warning(`Ticket ${issueKey} criado com avisos.`);
        setErr(warnings.join(" | "));
      } else {
        toast.success(`Ticket ${issueKey} criado no Jira.`);
        onOpenChange?.(false);
      }

      await onCreated?.(issueKey);
    } catch (error) {
      const body = error?.body || {};
      if (body?.errors && typeof body.errors === "object") {
        setFieldErrors(body.errors);
      }
      setErr(error?.message || "Falha ao criar ticket no Jira.");
    } finally {
      setSaving(false);
    }
  }

  function resetOnClose(nextOpen) {
    onOpenChange?.(nextOpen);
    if (nextOpen) return;
    setSummary("");
    setDescription("");
    setParentKey("");
    setFieldValues({});
    setAttachments([]);
    setLinks([]);
    setErr("");
    setFieldErrors({});
  }

  const modalBusy = loadingProjects || loadingMeta || saving;
  const showAdvanced = Object.values(grouped).some((items) => items.length);

  return (
    <Dialog open={open} onOpenChange={resetOnClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-6xl rounded-2xl sm:w-full max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Criar ticket no Jira
            {initialStatus ? (
              <Badge className="rounded-full bg-zinc-900 text-white">
                Status inicial: {initialStatus}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Fluxo do PO para criar uma demanda no Jira com campos e opcoes carregados do projeto selecionado.
          </DialogDescription>
        </DialogHeader>

        {err ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{err}</span>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-zinc-900">Basico</h3>
              <p className="text-xs text-zinc-500">
                Campos minimos para o Jira aceitar a criacao do ticket.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-700">
                  Espaco <span className="text-red-600">*</span>
                </span>
                <select
                  value={projectId || EMPTY}
                  onChange={(event) =>
                    setProjectId(event.target.value === EMPTY ? "" : event.target.value)
                  }
                  disabled={modalBusy}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value={EMPTY}>Selecionar projeto</option>
                  {projects.map((project) => (
                    <option key={project.id} value={String(project.id)}>
                      {projectDisplay(project)}
                    </option>
                  ))}
                </select>
                {fieldErrors.project ? (
                  <span className="text-xs font-medium text-red-700">
                    {fieldErrors.project}
                  </span>
                ) : null}
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-700">
                  Tipo do ticket <span className="text-red-600">*</span>
                </span>
                <select
                  value={issueTypeId || EMPTY}
                  onChange={(event) =>
                    setIssueTypeId(event.target.value === EMPTY ? "" : event.target.value)
                  }
                  disabled={modalBusy || !selectedProject}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value={EMPTY}>Selecionar tipo</option>
                  {issueTypes.map((type) => (
                    <option key={type.id} value={String(type.id)}>
                      {issueTypeDisplay(type)}
                    </option>
                  ))}
                </select>
                {fieldErrors.issuetype ? (
                  <span className="text-xs font-medium text-red-700">
                    {fieldErrors.issuetype}
                  </span>
                ) : null}
              </label>

              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-semibold text-zinc-700">
                  Resumo <span className="text-red-600">*</span>
                </span>
                <Input
                  value={summary}
                  onChange={(event) => {
                    setSummary(event.target.value);
                    setFieldErrors((prev) => {
                      if (!prev.summary) return prev;
                      const next = { ...prev };
                      delete next.summary;
                      return next;
                    });
                  }}
                  disabled={saving}
                  className="rounded-xl border-zinc-200 bg-white"
                  placeholder="Resumo da historia, tarefa ou demanda"
                />
                {fieldErrors.summary ? (
                  <span className="text-xs font-medium text-red-700">
                    {fieldErrors.summary}
                  </span>
                ) : null}
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-700">Pai</span>
                <IssuePickerField
                  value={parentKey}
                  onChange={setParentKey}
                  disabled={modalBusy || !selectedProject}
                  projectKey={selectedProject?.key}
                  jql={parentJql}
                  placeholder="Buscar pai compativel..."
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-700">
                  Status desejado apos criar
                </span>
                <select
                  value={desiredStatus || EMPTY}
                  onChange={(event) =>
                    setDesiredStatus(event.target.value === EMPTY ? "" : event.target.value)
                  }
                  disabled={modalBusy || !statusesForType.length}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value={EMPTY}>{initialStatus || "Status inicial"}</option>
                  {statusesForType.map((status) => (
                    <option key={status.id || status.name} value={status.name}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-semibold text-zinc-700">
                  Descricao
                </span>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={saving}
                  rows={6}
                  className="rounded-xl border-zinc-200 bg-white"
                />
              </label>
            </div>
          </section>

          {showAdvanced
            ? Object.entries(grouped).map(([section, items]) =>
                items.length ? (
                  <section
                    key={section}
                    className="rounded-2xl border border-zinc-200 bg-white p-4"
                  >
                    <div className="mb-3 flex flex-col gap-1">
                      <h3 className="text-sm font-semibold text-zinc-900">
                        {SECTION_TITLES[section]}
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Campos carregados pelo Jira para o projeto e tipo selecionados.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {items.map((field) => {
                        const id = getFieldId(field);
                        return (
                          <GenericField
                            key={id}
                            field={field}
                            value={fieldValues[id]}
                            onChange={(value) => setFieldValue(id, value)}
                            disabled={modalBusy}
                            fieldErrors={fieldErrors}
                            projectKey={selectedProject?.key}
                            parentJql={parentJql}
                          />
                        );
                      })}
                    </div>
                  </section>
                ) : null,
              )
            : null}

          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-zinc-900">
                Anexos e vinculos
              </h3>
              <p className="text-xs text-zinc-500">
                Anexos e links sao aplicados depois que o Jira retorna a key do ticket.
              </p>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-semibold text-zinc-700">Anexo</div>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl border-zinc-200 bg-white"
                    onClick={() => fileRef.current?.click()}
                    disabled={saving}
                  >
                    <Paperclip className="mr-2 h-4 w-4" />
                    Procurar
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      setAttachments(Array.from(event.target.files || []));
                    }}
                  />
                </div>
                {attachments.length ? (
                  <div className="grid gap-2">
                    {attachments.map((file) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs"
                      >
                        <span className="truncate font-medium text-zinc-800">
                          {file.name}
                        </span>
                        <span className="text-zinc-500">
                          {Math.ceil(file.size / 1024)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">
                    Nenhum arquivo selecionado.
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-semibold text-zinc-700">
                    Tickets vinculados
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl border-zinc-200 bg-white"
                    onClick={addLinkRow}
                    disabled={saving}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar vinculo
                  </Button>
                </div>
                {!links.length ? (
                  <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">
                    Nenhum vinculo informado.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {links.map((link) => (
                      <div
                        key={link.id}
                        className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-[220px_1fr_auto]"
                      >
                        <select
                          value={link.typeId || EMPTY}
                          onChange={(event) =>
                            updateLinkRow(link.id, {
                              typeId: event.target.value === EMPTY ? "" : event.target.value,
                            })
                          }
                          disabled={saving}
                          className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <option value={EMPTY}>Tipo de vinculo</option>
                          {issueLinkTypes.map((type) => (
                            <option key={type.id} value={String(type.id)}>
                              {type.name}
                            </option>
                          ))}
                        </select>
                        <IssuePickerField
                          value={link.key}
                          onChange={(key) => updateLinkRow(link.id, { key })}
                          disabled={saving || !selectedProject}
                          projectKey={selectedProject?.key}
                          placeholder="Digite, pesquise ou cole o URL"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl border-zinc-200 bg-white text-red-700 hover:bg-red-50"
                          onClick={() => removeLinkRow(link.id)}
                          disabled={saving}
                          title="Remover vinculo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            {modalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>
              {loadingProjects
                ? "Carregando projetos..."
                : loadingMeta
                  ? "Carregando campos do Jira..."
                  : selectedProject
                    ? projectDisplay(selectedProject)
                    : ""}
            </span>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={() => resetOnClose(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className={cn(
                "rounded-xl bg-red-600 text-white hover:bg-red-700",
                saving && "opacity-80",
              )}
              onClick={submit}
              disabled={modalBusy || !selectedProject || !selectedIssueType}
            >
              {saving ? "Criando..." : "Criar ticket"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
