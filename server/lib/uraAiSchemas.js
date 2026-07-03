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
