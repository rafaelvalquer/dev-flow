import {
  Bookmark,
  Check,
  Grid2X2,
  Plus,
  RefreshCcw,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { WIDGETS } from "./utils/developerWidgetRegistry";

function WorkspaceMenuCheckItem({ checked, children, onCheckedChange }) {
  return (
    <DropdownMenuItem
      className="developer-workspace-menu-check"
      onSelect={() => {
        window.setTimeout(() => {
          onCheckedChange?.(!checked);
        }, 0);
      }}
    >
      <span className="developer-workspace-menu-check__icon">
        {checked ? <Check className="h-4 w-4" /> : null}
      </span>
      <span>{children}</span>
    </DropdownMenuItem>
  );
}

export default function DeveloperWorkspaceHeader({
  currentUser,
  search,
  setSearch,
  visibleWidgetSet,
  toggleWidget,
  preferences,
  saveWorkspace,
  layouts,
  saving,
  onReload,
  loading,
  reloadProgress,
}) {
  const reloadText =
    loading && reloadProgress?.total
      ? `${reloadProgress.loaded || 0}/${reloadProgress.total}`
      : loading
        ? "Atualizando"
        : "Atualizar Jira";

  return (
    <div className="developer-workspace__top">
      <div className="developer-workspace__headline">
        <div className="developer-workspace__breadcrumb">
          <span>Central do Desenvolvedor</span>
          <span>/</span>
          <strong>Workspace</strong>
        </div>
        <h2>Bom dia, {currentUser?.name?.split(" ")?.[0] || "Rafael"}</h2>
        <p>Aqui está o que está acontecendo no seu workspace hoje.</p>
      </div>

      <div className="developer-workspace__actions">
        <div className="developer-command-search">
          <Search className="h-5 w-5" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar ticket..."
          />
          <kbd>K</kbd>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="developer-action-button developer-action-button--red">
              <Plus className="mr-2 h-4 w-4" />
              Adicionar widget
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Adicionar ou remover widgets</DropdownMenuLabel>
            {WIDGETS.map((widget) => (
              <WorkspaceMenuCheckItem
                key={widget.id}
                checked={visibleWidgetSet.has(widget.id)}
                onCheckedChange={(checked) => toggleWidget(widget.id, checked)}
              >
                {widget.label}
              </WorkspaceMenuCheckItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="developer-action-button">
              <Grid2X2 className="mr-2 h-4 w-4" />
              Customizar layout
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Widgets visíveis</DropdownMenuLabel>
            {WIDGETS.map((widget) => (
              <WorkspaceMenuCheckItem
                key={widget.id}
                checked={visibleWidgetSet.has(widget.id)}
                onCheckedChange={(checked) => toggleWidget(widget.id, checked)}
              >
                {widget.label}
              </WorkspaceMenuCheckItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Densidade</DropdownMenuLabel>
            <WorkspaceMenuCheckItem
              checked={preferences.density === "comfortable"}
              onCheckedChange={() =>
                saveWorkspace({ preferences: { density: "comfortable" } })
              }
            >
              Confortável
            </WorkspaceMenuCheckItem>
            <WorkspaceMenuCheckItem
              checked={preferences.density === "compact"}
              onCheckedChange={() =>
                saveWorkspace({ preferences: { density: "compact" } })
              }
            >
              Compacto
            </WorkspaceMenuCheckItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Ordenação padrão</DropdownMenuLabel>
            {[
              ["dueDate", "Data limite"],
              ["priority", "Prioridade"],
              ["updated", "Última atualização"],
              ["status", "Status"],
            ].map(([value, label]) => (
              <WorkspaceMenuCheckItem
                key={value}
                checked={preferences.sortBy === value}
                onCheckedChange={() => saveWorkspace({ preferences: { sortBy: value } })}
              >
                {label}
              </WorkspaceMenuCheckItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="outline"
          className="developer-action-button"
          onClick={() => saveWorkspace({ layout: layouts })}
          disabled={saving}
        >
          <Bookmark className="mr-2 h-4 w-4" />
          Salvar workspace
        </Button>

        <Button
          type="button"
          className="developer-action-button developer-action-button--solid"
          onClick={onReload}
          disabled={loading}
        >
          <RefreshCcw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          {reloadText}
        </Button>
      </div>
    </div>
  );
}
