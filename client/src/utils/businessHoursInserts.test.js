import { describe, expect, it } from "vitest";

import {
  generateBusinessHoursInserts,
  validateBusinessHoursConfig,
} from "./businessHoursInserts";

describe("businessHoursInserts", () => {
  it("gera uma URA com CLOSED dia inteiro", () => {
    expect(
      generateBusinessHoursInserts({
        selectedUras: ["URA_Inbursa"],
        rules: [{ date: "01/01/2026", status: "CLOSED" }],
      }),
    ).toBe(
      "--URA_Inbursa\n" +
        "insert into tb_bussinesshours values('URA_Inbursa','','01/01/2026','','','CLOSED');",
    );
  });

  it("gera uma URA com OPEN com horario", () => {
    expect(
      generateBusinessHoursInserts({
        selectedUras: ["RCV_PERFIL_1A8"],
        rules: [
          {
            date: "24/12/2025",
            startTime: "08:00",
            endTime: "20:00",
            status: "OPEN",
          },
        ],
      }),
    ).toBe(
      "--RCV_PERFIL_1A8\n" +
        "insert into tb_bussinesshours values('RCV_PERFIL_1A8','','24/12/2025','08:00','20:00','OPEN');",
    );
  });

  it("gera multiplas URAs", () => {
    expect(
      generateBusinessHoursInserts({
        selectedUras: ["RCV_PERFIL_1A8", "URA_Inbursa"],
        rules: [{ date: "01/05/2026", status: "CLOSED" }],
      }),
    ).toBe(
      "--RCV_PERFIL_1A8\n" +
        "insert into tb_bussinesshours values('RCV_PERFIL_1A8','','01/05/2026','','','CLOSED');\n\n" +
        "--URA_Inbursa\n" +
        "insert into tb_bussinesshours values('URA_Inbursa','','01/05/2026','','','CLOSED');",
    );
  });

  it("gera multiplas regras no mesmo dia", () => {
    expect(
      generateBusinessHoursInserts({
        selectedUras: ["RCV_PERFIL_1A8"],
        rules: [
          { date: "01/05/2026", startTime: "23:01", endTime: "23:59", status: "CLOSED" },
          { date: "01/05/2026", startTime: "00:00", endTime: "08:59", status: "CLOSED" },
          { date: "01/05/2026", startTime: "09:00", endTime: "23:00", status: "OPEN" },
        ],
      }),
    ).toBe(
      "--RCV_PERFIL_1A8\n" +
        "insert into tb_bussinesshours values('RCV_PERFIL_1A8','','01/05/2026','00:00','08:59','CLOSED');\n" +
        "insert into tb_bussinesshours values('RCV_PERFIL_1A8','','01/05/2026','09:00','23:00','OPEN');\n" +
        "insert into tb_bussinesshours values('RCV_PERFIL_1A8','','01/05/2026','23:01','23:59','CLOSED');",
    );
  });

  it("valida ausencia de URA selecionada", () => {
    const result = validateBusinessHoursConfig({
      selectedUras: [],
      rules: [{ date: "01/05/2026", status: "CLOSED" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Selecione pelo menos uma URA.");
  });

  it("valida ausencia de regras", () => {
    const result = validateBusinessHoursConfig({
      selectedUras: ["URA_Inbursa"],
      rules: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Adicione pelo menos uma regra.");
  });

  it("valida campos obrigatorios", () => {
    const result = validateBusinessHoursConfig({
      selectedUras: ["URA_Inbursa"],
      rules: [{ date: "", status: "OPEN", startTime: "", endTime: "" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Regra 1: data obrigatoria.");
    expect(result.errors).toContain("Regra 1: OPEN exige hora inicial e hora final.");
  });

  it("valida hora final menor que inicial", () => {
    const result = validateBusinessHoursConfig({
      selectedUras: ["URA_Inbursa"],
      rules: [{ date: "01/05/2026", status: "OPEN", startTime: "13:00", endTime: "08:00" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Regra 1: hora final nao pode ser menor que hora inicial.");
  });

  it("valida regra duplicada apos expandir por URA", () => {
    const result = validateBusinessHoursConfig({
      selectedUras: ["URA_Inbursa"],
      rules: [
        { date: "01/05/2026", status: "CLOSED", startTime: "", endTime: "" },
        { date: "01/05/2026", status: "CLOSED", startTime: "", endTime: "" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Regra duplicada para URA_Inbursa em 01/05/2026.");
  });

  it("ordena por URA selecionada, data e horario", () => {
    expect(
      generateBusinessHoursInserts({
        selectedUras: ["URA_B", "URA_A"],
        rules: [
          { date: "02/05/2026", status: "CLOSED" },
          { date: "01/05/2026", status: "OPEN", startTime: "09:00", endTime: "18:00" },
          { date: "01/05/2026", status: "CLOSED", startTime: "00:00", endTime: "08:59" },
        ],
      }),
    ).toBe(
      "--URA_B\n" +
        "insert into tb_bussinesshours values('URA_B','','01/05/2026','00:00','08:59','CLOSED');\n" +
        "insert into tb_bussinesshours values('URA_B','','01/05/2026','09:00','18:00','OPEN');\n" +
        "insert into tb_bussinesshours values('URA_B','','02/05/2026','','','CLOSED');\n\n" +
        "--URA_A\n" +
        "insert into tb_bussinesshours values('URA_A','','01/05/2026','00:00','08:59','CLOSED');\n" +
        "insert into tb_bussinesshours values('URA_A','','01/05/2026','09:00','18:00','OPEN');\n" +
        "insert into tb_bussinesshours values('URA_A','','02/05/2026','','','CLOSED');",
    );
  });

  it("gera regras direcionadas por URA no mesmo lote", () => {
    expect(
      generateBusinessHoursInserts({
        selectedUras: ["RCV_PERFIL_1A8", "RCV_PERFIL_8", "URA_Inbursa"],
        rules: [
          {
            date: "01/05/2026",
            status: "CLOSED",
            startTime: "00:00",
            endTime: "08:59",
            targetUras: ["RCV_PERFIL_1A8"],
          },
          {
            date: "01/05/2026",
            status: "OPEN",
            startTime: "09:00",
            endTime: "23:00",
            targetUras: ["RCV_PERFIL_1A8"],
          },
          {
            date: "01/05/2026",
            status: "CLOSED",
            targetUras: ["RCV_PERFIL_8", "URA_Inbursa"],
          },
        ],
      }),
    ).toBe(
      "--RCV_PERFIL_1A8\n" +
        "insert into tb_bussinesshours values('RCV_PERFIL_1A8','','01/05/2026','00:00','08:59','CLOSED');\n" +
        "insert into tb_bussinesshours values('RCV_PERFIL_1A8','','01/05/2026','09:00','23:00','OPEN');\n\n" +
        "--RCV_PERFIL_8\n" +
        "insert into tb_bussinesshours values('RCV_PERFIL_8','','01/05/2026','','','CLOSED');\n\n" +
        "--URA_Inbursa\n" +
        "insert into tb_bussinesshours values('URA_Inbursa','','01/05/2026','','','CLOSED');",
    );
  });

  it("valida duplicidade considerando escopo por URA", () => {
    const result = validateBusinessHoursConfig({
      selectedUras: ["RCV_PERFIL_1A8", "RCV_PERFIL_8"],
      rules: [
        {
          date: "01/05/2026",
          status: "CLOSED",
          targetUras: ["RCV_PERFIL_1A8"],
        },
        {
          date: "01/05/2026",
          status: "CLOSED",
          targetUras: ["RCV_PERFIL_8"],
        },
      ],
    });

    expect(result.valid).toBe(true);
  });
});
