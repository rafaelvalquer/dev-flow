export const WIDGETS = [
  { id: "queue", label: "Minha fila" },
  { id: "statusQueue", label: "Fila por status" },
  { id: "daily", label: "Daily de hoje" },
  { id: "nextActions", label: "Próximas ações" },
  { id: "risk", label: "Tickets em risco" },
  { id: "calendar", label: "Calendário" },
  { id: "recent", label: "Últimos acessados" },
  { id: "rhythm", label: "Meu ritmo" },
  { id: "notes", label: "Notas pessoais" },
  { id: "productivity", label: "Atalhos rápidos" },
];

export const DEFAULT_VISIBLE_WIDGETS = WIDGETS.map((widget) => widget.id);
export const DEFAULT_LAYOUTS = {
  lg: [
    { i: "queue", x: 0, y: 0, w: 6, h: 5, minW: 5, minH: 4 },
    { i: "statusQueue", x: 6, y: 0, w: 3, h: 5, minW: 3, minH: 4 },
    { i: "risk", x: 9, y: 0, w: 3, h: 5, minW: 3, minH: 4 },
    { i: "nextActions", x: 0, y: 5, w: 3, h: 5, minW: 3, minH: 4 },
    { i: "calendar", x: 3, y: 5, w: 5, h: 6, minW: 4, minH: 5 },
    { i: "daily", x: 8, y: 5, w: 3, h: 5, minW: 3, minH: 4 },
    { i: "recent", x: 0, y: 11, w: 3, h: 5, minW: 2, minH: 5 },
    { i: "productivity", x: 3, y: 11, w: 3, h: 5, minW: 2, minH: 5 },
    { i: "notes", x: 6, y: 11, w: 6, h: 6, minW: 3, minH: 5 },
    { i: "rhythm", x: 0, y: 16, w: 3, h: 5, minW: 3, minH: 4 },
  ],
  md: [
    { i: "queue", x: 0, y: 0, w: 6, h: 6 },
    { i: "statusQueue", x: 6, y: 0, w: 4, h: 5 },
    { i: "risk", x: 6, y: 5, w: 4, h: 5 },
    { i: "calendar", x: 0, y: 6, w: 6, h: 6 },
    { i: "nextActions", x: 0, y: 12, w: 5, h: 5 },
    { i: "daily", x: 5, y: 12, w: 5, h: 5, minW: 3, minH: 4 },
    { i: "recent", x: 0, y: 17, w: 4, h: 5 },
    { i: "productivity", x: 4, y: 17, w: 2, h: 5 },
    { i: "rhythm", x: 6, y: 17, w: 4, h: 5 },
    { i: "notes", x: 0, y: 22, w: 10, h: 5 },
  ],
  sm: WIDGETS.map((widget, index) => ({
    i: widget.id,
    x: 0,
    y: index * 5,
    w: 6,
    h: widget.id === "queue" ? 8 : 5,
  })),
};

export const GRID_BREAKPOINTS = {
  lg: { cols: 12, w: 3, h: 4, minW: 2, minH: 3 },
  md: { cols: 10, w: 4, h: 4, minW: 3, minH: 3 },
  sm: { cols: 6, w: 6, h: 4, minW: 6, minH: 3 },
};

export const EMPTY_WORKSPACE = {
  preferences: {
    visibleWidgets: DEFAULT_VISIBLE_WIDGETS,
    density: "comfortable",
    sortBy: "dueDate",
    startMode: "workspace",
    autoSyncOnOpen: true,
  },
  layout: DEFAULT_LAYOUTS,
  recentTickets: [],
  stickyNotes: [],
  notesByTicket: {},
};

export const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "Para Dev", label: "Para Dev" },
  { value: "Desenvolvimento", label: "Desenvolvimento" },
  { value: "Para Homolog.", label: "Para Homolog." },
  { value: "Homologacao", label: "Homologação" },
  { value: "Para Deploy", label: "Para Deploy" },
];

export const PRIORITY_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "highest", label: "Highest" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const DUE_FILTERS = [
  { value: "all", label: "Qualquer prazo" },
  { value: "overdue", label: "Atrasados" },
  { value: "today", label: "Hoje" },
  { value: "week", label: "Esta semana" },
  { value: "none", label: "Sem data" },
];
