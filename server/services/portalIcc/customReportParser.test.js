import test from "node:test";
import assert from "node:assert/strict";

import { parseCustomReportHtml } from "./customReportParser.js";

test("parseCustomReportHtml maps rows by HTML headers", () => {
  const html = `
    <html>
      <body>
        <table>
          <caption>Total de 2 registros</caption>
          <thead>
            <tr>
              <th>DIA_SEMANA</th>
              <th>FECHAMENTO</th>
              <th>STATUS</th>
              <th>NOME</th>
              <th>DATA</th>
              <th>ABERTURA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td></td>
              <td>23:59</td>
              <td>CLOSED</td>
              <td>RCV_PERFIL_1A8</td>
              <td>21/04/2026</td>
              <td>23:01</td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `;

  const result = parseCustomReportHtml(html);

  assert.deepEqual(result.columns, [
    "DIA_SEMANA",
    "FECHAMENTO",
    "STATUS",
    "NOME",
    "DATA",
    "ABERTURA",
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.source, "portal-custom-report");
  assert.deepEqual(result.rows[0], {
    DIA_SEMANA: "",
    FECHAMENTO: "23:59",
    STATUS: "CLOSED",
    NOME: "RCV_PERFIL_1A8",
    DATA: "21/04/2026",
    ABERTURA: "23:01",
  });
});

test("parseCustomReportHtml returns empty result when no table exists", () => {
  const result = parseCustomReportHtml("<html><body><p>Sem registros</p></body></html>");

  assert.deepEqual(result, {
    columns: [],
    rows: [],
    total: 0,
    source: "portal-custom-report",
  });
});

test("parseCustomReportHtml rejects login page", () => {
  assert.throws(
    () =>
      parseCustomReportHtml(`
        <form action="/portalicc/login">
          <input name="username" />
          <input name="password" type="password" />
        </form>
      `),
    /Login nao autenticado|sessao expirada/i,
  );
});
