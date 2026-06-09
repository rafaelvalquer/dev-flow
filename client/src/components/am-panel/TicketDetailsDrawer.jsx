export default function TicketDetailsDrawer({
  DetailsComponent,
  open,
  onOpenChange,
  issueKey,
  ticketMetaMap,
  statusOptions,
  priorityOptions,
  onChangeStatus,
  onChangePriority,
  onChangeDueDate,
  onDocumentationFlagChange,
  onOpenDocumentation,
  onOpenSchedule,
  onTicketUpdated,
  onMarkedStarted,
}) {
  const Details = DetailsComponent;

  return (
    <Details
      open={open}
      onOpenChange={onOpenChange}
      issueKey={issueKey}
      ticketMetaMap={ticketMetaMap}
      statusOptions={statusOptions}
      priorityOptions={priorityOptions}
      onChangeStatus={onChangeStatus}
      onChangePriority={onChangePriority}
      onChangeDueDate={onChangeDueDate}
      onDocumentationFlagChange={onDocumentationFlagChange}
      onOpenDocumentation={onOpenDocumentation}
      onOpenSchedule={onOpenSchedule}
      onTicketUpdated={onTicketUpdated}
      onMarkedStarted={onMarkedStarted}
    />
  );
}
