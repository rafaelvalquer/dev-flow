import { describe, expect, it } from "vitest";

import {
  PERSONAL_QUEUE_COLUMNS,
  PERSONAL_QUEUE_OTHER_STATUS,
} from "./amPanelConstants";
import { getQueueStatus } from "./PersonalQueueView";

describe("Kanban Minha Carteira", () => {
  it("mantem os dois status de desenvolvimento antes de Outros", () => {
    const desenvolvimentoIndex = PERSONAL_QUEUE_COLUMNS.indexOf("Desenvolvimento");
    const emDesenvolvimentoIndex = PERSONAL_QUEUE_COLUMNS.indexOf("Em Desenvolvimento");
    const outrosIndex = PERSONAL_QUEUE_COLUMNS.indexOf(PERSONAL_QUEUE_OTHER_STATUS);

    expect(desenvolvimentoIndex).toBeGreaterThanOrEqual(0);
    expect(emDesenvolvimentoIndex).toBe(desenvolvimentoIndex + 1);
    expect(emDesenvolvimentoIndex).toBeLessThan(outrosIndex);
  });

  it("classifica Em Desenvolvimento em sua propria coluna", () => {
    const issue = { fields: { status: { name: "Em Desenvolvimento" } } };

    expect(getQueueStatus(issue)).toBe("Em Desenvolvimento");
    expect(getQueueStatus(issue)).not.toBe(PERSONAL_QUEUE_OTHER_STATUS);
  });
});
