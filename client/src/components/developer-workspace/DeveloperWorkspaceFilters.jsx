import { Filter } from "lucide-react";

import { FilterSelect } from "./components/FilterSelect";
import {
  DUE_FILTERS,
  PRIORITY_FILTERS,
  STATUS_FILTERS,
} from "./utils/developerWidgetRegistry";

export default function DeveloperWorkspaceFilters({
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  dueFilter,
  setDueFilter,
  pendencyFilter,
  setPendencyFilter,
}) {
  return (
    <div className="developer-filter-strip">
      <FilterSelect
        icon={Filter}
        value={statusFilter}
        onChange={setStatusFilter}
        options={STATUS_FILTERS}
      />
      <FilterSelect
        value={priorityFilter}
        onChange={setPriorityFilter}
        options={PRIORITY_FILTERS}
      />
      <FilterSelect value={dueFilter} onChange={setDueFilter} options={DUE_FILTERS} />
      <FilterSelect
        value={pendencyFilter}
        onChange={setPendencyFilter}
        options={[
          { value: "all", label: "Todas pendências" },
          { value: "noEvidence", label: "Sem evidência" },
          { value: "waitingGmud", label: "Aguardando GMUD" },
        ]}
      />
    </div>
  );
}
