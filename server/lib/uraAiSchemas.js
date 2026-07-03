export const URA_AI_ENRICHMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    context: {
      type: "OBJECT",
      properties: {
        uraName: { type: "STRING" },
        businessPurpose: { type: "STRING" },
        audience: { type: "ARRAY", items: { type: "STRING" } },
        mainCompanies: { type: "ARRAY", items: { type: "STRING" } },
        mainDomains: { type: "ARRAY", items: { type: "STRING" } },
        flowType: { type: "STRING" },
        language: { type: "STRING" },
      },
    },
    functionalOverview: { type: "STRING" },
    businessRules: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          title: { type: "STRING" },
          description: { type: "STRING" },
          evidence: { type: "ARRAY", items: { type: "STRING" } },
        },
      },
    },
    technicalRules: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          title: { type: "STRING" },
          description: { type: "STRING" },
          evidence: { type: "ARRAY", items: { type: "STRING" } },
        },
      },
    },
    menuInterpretation: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          company: { type: "STRING" },
          level: { type: "NUMBER" },
          menuName: { type: "STRING" },
          actionId: { type: "STRING" },
          options: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                digit: { type: "STRING" },
                label: { type: "STRING" },
                target: { type: "STRING" },
                confidence: { type: "NUMBER" },
                evidence: { type: "ARRAY", items: { type: "STRING" } },
              },
            },
          },
        },
      },
    },
    promptAnalysis: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          fileName: { type: "STRING" },
          cleanTranscript: { type: "STRING" },
          intent: { type: "STRING" },
          menuOptions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                digit: { type: "STRING" },
                label: { type: "STRING" },
              },
            },
          },
          issues: { type: "ARRAY", items: { type: "STRING" } },
        },
      },
    },
    drawioAnnotations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          actionId: { type: "STRING" },
          title: { type: "STRING" },
          subtitle: { type: "STRING" },
          description: { type: "STRING" },
          spokenText: { type: "STRING" },
          badge: { type: "STRING" },
          group: { type: "STRING" },
          riskLevel: { type: "STRING" },
          confidence: { type: "NUMBER" },
          evidence: { type: "ARRAY", items: { type: "STRING" } },
        },
      },
    },
    issues: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          severity: { type: "STRING" },
          category: { type: "STRING" },
          title: { type: "STRING" },
          description: { type: "STRING" },
          evidence: { type: "ARRAY", items: { type: "STRING" } },
          suggestion: { type: "STRING" },
        },
      },
    },
    testCases: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          title: { type: "STRING" },
          steps: { type: "ARRAY", items: { type: "STRING" } },
          expectedResult: { type: "STRING" },
          type: { type: "STRING" },
          priority: { type: "STRING" },
          evidence: { type: "ARRAY", items: { type: "STRING" } },
        },
      },
    },
    runbook: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          problem: { type: "STRING" },
          whereToCheck: { type: "STRING" },
          technicalCheck: { type: "STRING" },
          businessImpact: { type: "STRING" },
        },
      },
    },
    executiveSummary: { type: "STRING" },
    developerSummary: { type: "STRING" },
    businessSummary: { type: "STRING" },
  },
};

export const URA_AI_ORGANIZER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "flowContext",
    "actionAnnotations",
    "menuLabels",
    "visualGroups",
    "routeHints",
    "drawioRecommendations",
    "issues",
  ],
  properties: {
    flowContext: {
      type: "object",
      additionalProperties: false,
      required: [
        "flowName",
        "flowType",
        "businessPurpose",
        "audience",
        "mainDomains",
        "mainJourneys",
      ],
      properties: {
        flowName: { type: "string" },
        flowType: { type: "string" },
        businessPurpose: { type: "string" },
        audience: { type: "array", items: { type: "string" } },
        mainDomains: { type: "array", items: { type: "string" } },
        mainJourneys: { type: "array", items: { type: "string" } },
      },
    },
    actionAnnotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "actionId",
          "businessLabel",
          "shortLabel",
          "description",
          "category",
          "group",
          "riskLevel",
          "confidence",
          "evidence",
        ],
        properties: {
          actionId: { type: "string" },
          businessLabel: { type: "string" },
          shortLabel: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          group: { type: "string" },
          riskLevel: { type: "string" },
          confidence: { type: "number" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    menuLabels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["menuActionId", "menuName", "captureVariable", "options"],
        properties: {
          menuActionId: { type: "string" },
          menuName: { type: "string" },
          captureVariable: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "digit",
                "label",
                "description",
                "targetActionId",
                "confidence",
                "evidence",
              ],
              properties: {
                digit: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
                targetActionId: { type: "string" },
                confidence: { type: "number" },
                evidence: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
    visualGroups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["groupId", "title", "description", "actionIds"],
        properties: {
          groupId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          actionIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    routeHints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["originActionId", "path", "label", "group", "targetActionId", "evidence"],
        properties: {
          originActionId: { type: "string" },
          path: { type: "array", items: { type: "string" } },
          label: { type: "string" },
          group: { type: "string" },
          targetActionId: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    drawioRecommendations: {
      type: "object",
      additionalProperties: false,
      required: ["mainPageTitle", "maxMainBlocks", "suggestedPages"],
      properties: {
        mainPageTitle: { type: "string" },
        maxMainBlocks: { type: "number" },
        suggestedPages: { type: "array", items: { type: "string" } },
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "title", "description", "evidence", "suggestion"],
        properties: {
          severity: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          suggestion: { type: "string" },
        },
      },
    },
  },
};

export function emptyUraAiEnrichment({ reason = "" } = {}) {
  return {
    context: {
      uraName: "",
      businessPurpose: "",
      audience: [],
      mainCompanies: [],
      mainDomains: [],
      flowType: "",
      language: "pt-BR",
    },
    functionalOverview: "",
    businessRules: [],
    technicalRules: [],
    menuInterpretation: [],
    promptAnalysis: [],
    drawioAnnotations: [],
    issues: reason
      ? [
          {
            severity: "info",
            category: "ai_unavailable",
            title: "Analise por IA indisponivel",
            description: reason,
            evidence: [],
            suggestion:
              "Configure OPENAI_API_KEY ou habilite a IA para obter enriquecimento funcional.",
          },
        ]
      : [],
    testCases: [],
    runbook: [],
    executiveSummary: "",
    developerSummary: "",
    businessSummary: "",
  };
}
