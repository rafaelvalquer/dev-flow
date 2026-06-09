export const STATUS_OPTIONS = [
  "Backlog",
  "Refinamento",
  "Artefatos",
  "Planejamento",
  "PRE SAVE",
  "Para testes",
  "Testes",
  "Homologação",
  "Art. Externos",
  "Para Planejar",
  "EM PLANEJAMENTO",
  "Para Dev",
  "Desenvolvimento",
  "Para Homolog.",
  "Homolog. Negócio",
  "Para Deploy",
  "Concluído",
];

export const PERSONAL_QUEUE_OTHER_STATUS = "Outros";
export const PERSONAL_QUEUE_COLUMNS = [
  ...STATUS_OPTIONS,
  PERSONAL_QUEUE_OTHER_STATUS,
];

export const PRIORITY_OPTIONS = [
  { name: "HIGHEST", color: "#b91c1c" },
  { name: "HIGH", color: "#d97706" },
  { name: "MEDIUM", color: "#3b82f6" },
  { name: "LOW", color: "#22c55e" },
  { name: "LOWEST", color: "#6b7280" },
];

export const DOCUMENTATION_FOLDER_LABEL = "pasta-criada";
