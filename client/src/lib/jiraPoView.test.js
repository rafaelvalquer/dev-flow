import { describe, expect, it } from "vitest";

import { PO_JQL_BODY } from "./jiraPoView";

describe("PO_JQL_BODY", () => {
  it("inclui os nomes de status de desenvolvimento suportados", () => {
    expect(PO_JQL_BODY.jql).toContain('"Desenvolvimento"');
    expect(PO_JQL_BODY.jql).toContain('"Em Desenvolvimento"');
  });
});
