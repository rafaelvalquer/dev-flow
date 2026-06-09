import GanttTab from "../GanttTab";

export default function AMGanttView({
  loading,
  viewData,
  colorMode,
  setColorMode,
  filterText,
  setFilterText,
  onPersistDateChange,
  onPersistMetaChange,
  changeHistory,
  calendarSettings,
  onOpenDetails,
}) {
  return (
    <section className="grid gap-3">
      <GanttTab
        loading={loading}
        viewData={viewData}
        colorMode={colorMode}
        setColorMode={setColorMode}
        filterText={filterText}
        setFilterText={setFilterText}
        onPersistDateChange={onPersistDateChange}
        onPersistMetaChange={onPersistMetaChange}
        changeHistory={changeHistory}
        calendarSettings={calendarSettings}
        onOpenDetails={onOpenDetails}
      />
    </section>
  );
}
