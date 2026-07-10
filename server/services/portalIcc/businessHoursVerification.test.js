import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBusinessHoursCoverage,
  buildBusinessHoursVerificationSql,
  normalizeBusinessHoursRequest,
  sanitizeCustomReportSql,
} from "./portalClient.js";

test("normalizeBusinessHoursRequest validates database, date and URAs", () => {
  assert.deepEqual(
    normalizeBusinessHoursRequest({
      database: "AWS_ROTEAMENTO",
      date: "22/12/2025",
      uras: [" RCV_PERFIL_1A8 ", "rcv_perfil_1a8", "URA_Inbursa"],
    }),
    {
      database: "AWS_ROTEAMENTO",
      date: "22/12/2025",
      uras: ["RCV_PERFIL_1A8", "URA_Inbursa"],
    },
  );

  assert.throws(
    () =>
      normalizeBusinessHoursRequest({
        database: "FORA",
        date: "22/12/2025",
        uras: ["URA"],
      }),
    /Banco nao permitido/,
  );

  assert.throws(
    () =>
      normalizeBusinessHoursRequest({
        database: "AWS_ROTEAMENTO",
        date: "31/02/2025",
        uras: ["URA"],
      }),
    /DD\/MM\/YYYY/,
  );

  assert.throws(
    () =>
      normalizeBusinessHoursRequest({
        database: "AWS_ROTEAMENTO",
        date: "22/12/2025",
        uras: [],
      }),
    /Selecione pelo menos uma URA/,
  );
});

test("buildBusinessHoursVerificationSql escapes values and uses safe predicates", () => {
  const sql = buildBusinessHoursVerificationSql({
    date: "22/12/2025",
    uras: ["RCV_PERFIL_1A8", "URA'Oeste"],
  });

  assert.match(sql, /FROM TB_BUSSINESSHOURS/);
  assert.match(sql, /WHERE TRIM\(DATA\) = '22\/12\/2025'/);
  assert.match(sql, /UPPER\(TRIM\(NOME\)\) IN/);
  assert.match(sql, /'RCV_PERFIL_1A8'/);
  assert.match(sql, /'URA''OESTE'/);
  assert.match(sql, /ORDER BY\s+NOME,\s+ABERTURA,\s+FECHAMENTO,\s+STATUS/s);
  assert.doesNotMatch(sql, /;\s*$/);
});

test("sanitizeCustomReportSql removes trailing semicolons", () => {
  assert.equal(sanitizeCustomReportSql("SELECT * FROM T;"), "SELECT * FROM T");
  assert.equal(sanitizeCustomReportSql("SELECT * FROM T;;  "), "SELECT * FROM T");
});

test("buildBusinessHoursCoverage classifies missing, configured and multiple_rules", () => {
  const result = buildBusinessHoursCoverage({
    selectedUras: ["RCV_PERFIL_1A8", "URA_Inbursa", "URA_Extra"],
    rows: [
      {
        NOME: "RCV_PERFIL_1A8",
        DATA: "22/12/2025",
        ABERTURA: "08:00",
        FECHAMENTO: "23:59",
        STATUS: "OPEN",
      },
      {
        NOME: "URA_Inbursa",
        DATA: "22/12/2025",
        ABERTURA: "00:00",
        FECHAMENTO: "08:59",
        STATUS: "CLOSED",
      },
      {
        NOME: "URA_Inbursa",
        DATA: "22/12/2025",
        ABERTURA: "09:00",
        FECHAMENTO: "23:59",
        STATUS: "OPEN",
      },
    ],
  });

  assert.deepEqual(result.summary, {
    selected: 3,
    configured: 2,
    missing: 1,
    rows: 3,
  });
  assert.equal(result.coverage[0].status, "configured");
  assert.equal(result.coverage[1].status, "multiple_rules");
  assert.equal(result.coverage[2].status, "missing");
});
