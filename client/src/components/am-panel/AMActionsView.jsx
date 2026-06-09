import { POActionsHub } from "../POManagementViews";

export default function AMActionsView({
  insights,
  TicketDashboardComponent,
  rows,
  alertas,
  missingSchedule,
  ticketMetaMap,
  loading,
  dashTab,
  setDashTab,
  searchText,
  setSearchText,
  selectedStatuses,
  setSelectedStatuses,
  selectedAssignees,
  setSelectedAssignees,
  selectedTypes,
  setSelectedTypes,
  sortBy,
  setSortBy,
  movingKeys,
  onStart,
  onOpenDetails,
  onOpenSchedule,
  onOpenDocumentation,
  onResolveProblem,
  onMoveStatus,
}) {
  const Dashboard = TicketDashboardComponent;

  return (
    <div className="grid gap-4">
      <POActionsHub
        insights={insights}
        onOpenDetails={onOpenDetails}
        onOpenSchedule={onOpenSchedule}
        onOpenDocumentation={onOpenDocumentation}
        onResolveProblem={onResolveProblem}
      />

      <Dashboard
        rows={rows || []}
        alertas={alertas || []}
        missingSchedule={missingSchedule || []}
        ticketMetaMap={ticketMetaMap}
        loading={loading}
        dashTab={dashTab}
        setDashTab={setDashTab}
        searchText={searchText}
        setSearchText={setSearchText}
        selectedStatuses={selectedStatuses}
        setSelectedStatuses={setSelectedStatuses}
        selectedAssignees={selectedAssignees}
        setSelectedAssignees={setSelectedAssignees}
        selectedTypes={selectedTypes}
        setSelectedTypes={setSelectedTypes}
        sortBy={sortBy}
        setSortBy={setSortBy}
        onStart={onStart}
        onOpenDetails={onOpenDetails}
        onOpenSchedule={onOpenSchedule}
        onOpenDocumentation={onOpenDocumentation}
        movingKeys={movingKeys}
        onMoveStatus={onMoveStatus}
      />
    </div>
  );
}
