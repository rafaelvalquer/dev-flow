import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { AppError } from "../utils/http.js";
import { FIELD_OPTIONS } from "../services/portalIcc/cdrColumns.js";
import { analyzeCdrCsv } from "../services/portalIcc/cdrAnalytics.js";
import {
  createPortalIccClient,
  getPortalIccClient,
  removePortalIccSession,
  requirePortalIccClient,
} from "../services/portalIcc/sessionStore.js";

function toPublicError(err) {
  if (err instanceof AppError) return err;

  const networkErrorCodes = new Set([
    "ECONNRESET",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ]);
  const isNetworkError = networkErrorCodes.has(err?.code);
  const isPortalSessionExpired =
    err?.code === "PORTAL_SESSION_EXPIRED" ||
    Number(err?.status) === 417 ||
    Number(err?.response?.status) === 417;

  return new AppError({
    status: Number(
      isPortalSessionExpired ? 401 : err?.status || (isNetworkError ? 502 : 400),
    ),
    code: isPortalSessionExpired
      ? "PORTAL_SESSION_EXPIRED"
      : isNetworkError
        ? "PORTAL_ICC_NETWORK_ERROR"
        : err?.code || "PORTAL_ICC_ERROR",
    message: isPortalSessionExpired
      ? "Sessão Portal ICC expirada. Faça login novamente."
      : err?.message || "Falha ao acessar Portal ICC.",
    details: err?.details || {
      code: err?.code,
      status: err?.response?.status,
      location: err?.response?.headers?.location,
      address: err?.address || err?.cause?.address,
      port: err?.port || err?.cause?.port,
    },
  });
}

function normalizeCdrExportFilters(source = {}) {
  const filters = {
    dataInicial: String(source.dataInicial || "").slice(0, 10),
    dataFinal: String(source.dataFinal || "").slice(0, 10),
  };

  for (let index = 1; index <= 5; index += 1) {
    filters[`campo${index}`] = String(source[`campo${index}`] || "0").trim() || "0";
    filters[`valor${index}`] = String(source[`valor${index}`] || "").trim();
  }

  const segmento = String(source.segmento || "").trim();
  if (segmento && (!source.campo1 || source.campo1 === "0")) {
    filters.campo1 = "segmento";
    filters.valor1 = segmento;
  }

  return filters;
}

function activeFilterLabel(filters = {}) {
  for (let index = 1; index <= 5; index += 1) {
    const campo = String(filters[`campo${index}`] || "0");
    const valor = String(filters[`valor${index}`] || "");
    if (campo !== "0" && valor) return valor;
  }
  if (filters.dataInicial && filters.dataInicial === filters.dataFinal) return filters.dataInicial;
  return `${filters.dataInicial || "-"} a ${filters.dataFinal || "-"}`;
}

async function runCdrAnalytics(client, source) {
  const filters = normalizeCdrExportFilters(source);
  const exported = await client.exportCdrCsv(filters);
  const analytics = analyzeCdrCsv(exported.csvText, filters);

  return {
    export: {
      bytes: exported.bytes,
      contentType: exported.contentType,
      filename: exported.filename,
      filters: exported.filters,
    },
    analytics,
  };
}

function metricDelta(left, right) {
  const delta = Number(right || 0) - Number(left || 0);
  return {
    left,
    right,
    delta,
    deltaPercent: Number(left || 0) ? delta / Number(left || 0) : null,
  };
}

function compareRankings(leftRows = [], rightRows = [], keyName) {
  const byKey = new Map();
  leftRows.forEach((row) => {
    const key = String(row[keyName] || row.key || row.label || "");
    if (!key) return;
    byKey.set(key, {
      key,
      label: row.label || key,
      left: Number(row.count || 0),
      right: 0,
    });
  });
  rightRows.forEach((row) => {
    const key = String(row[keyName] || row.key || row.label || "");
    if (!key) return;
    const current = byKey.get(key) || {
      key,
      label: row.label || key,
      left: 0,
      right: 0,
    };
    current.right = Number(row.count || 0);
    byKey.set(key, current);
  });

  return [...byKey.values()]
    .map((row) => ({
      ...row,
      delta: row.right - row.left,
    }))
    .sort((a, b) => Math.max(b.left, b.right) - Math.max(a.left, a.right))
    .slice(0, 15);
}

function buildCdrComparison({ leftLabel, rightLabel, left, right }) {
  const leftSummary = left.summary || {};
  const rightSummary = right.summary || {};

  return {
    labels: { left: leftLabel, right: rightLabel },
    metrics: {
      analyzedCalls: metricDelta(leftSummary.analyzedCalls || 0, rightSummary.analyzedCalls || 0),
      averageTotalSeconds: metricDelta(
        leftSummary.averageTotalSeconds || 0,
        rightSummary.averageTotalSeconds || 0,
      ),
      averageUraSeconds: metricDelta(
        leftSummary.averageUraSeconds || 0,
        rightSummary.averageUraSeconds || 0,
      ),
      transferTotal: metricDelta(leftSummary.transferTotal || 0, rightSummary.transferTotal || 0),
      transferRate: metricDelta(leftSummary.transferRate || 0, rightSummary.transferRate || 0),
    },
    charts: {
      kpis: [
        {
          key: "analyzedCalls",
          label: "Chamadas",
          left: leftSummary.analyzedCalls || 0,
          right: rightSummary.analyzedCalls || 0,
        },
        {
          key: "averageTotalSeconds",
          label: "TMA total (s)",
          left: Math.round(leftSummary.averageTotalSeconds || 0),
          right: Math.round(rightSummary.averageTotalSeconds || 0),
        },
        {
          key: "averageUraSeconds",
          label: "TMA URA (s)",
          left: Math.round(leftSummary.averageUraSeconds || 0),
          right: Math.round(rightSummary.averageUraSeconds || 0),
        },
        {
          key: "transferTotal",
          label: "Transferencias",
          left: leftSummary.transferTotal || 0,
          right: rightSummary.transferTotal || 0,
        },
      ],
      dna: compareRankings(left.charts?.dnaRanking, right.charts?.dnaRanking, "dna"),
      skills: compareRankings(left.charts?.skills, right.charts?.skills, "key"),
    },
  };
}

export default function toolsCdrRoutes({ env }) {
  const router = Router();
  const requirePortal = requirePortalIccClient(env);

  router.use(requireAuth);

  router.get("/auth/status", async (req, res, next) => {
    try {
      const client = getPortalIccClient(req, env);
      if (!client) {
        return res.json({ ok: true, authenticated: false });
      }

      const session = await client.getSafeSessionSummary();
      return res.json({ ok: true, authenticated: true, session });
    } catch (err) {
      next(toPublicError(err));
    }
  });

  router.post("/auth/login", async (req, res, next) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    try {
      req.log?.("info", "portal-icc.login.request", {
        username,
        portalBaseUrl: env.PORTAL_ICC_BASE_URL,
      });

      const client = createPortalIccClient(req, env);
      const session = await client.login({ username, password });

      req.session.portalIcc = {
        username,
        loggedAt: session.loggedAt,
      };

      await new Promise((resolve, reject) => {
        req.session.save((error) => (error ? reject(error) : resolve()));
      });

      return res.json({
        ok: true,
        authenticated: true,
        message: "Login Portal ICC realizado com sucesso.",
        session,
      });
    } catch (err) {
      removePortalIccSession(req);
      next(toPublicError(err));
    }
  });

  router.post("/auth/logout", (req, res) => {
    removePortalIccSession(req);
    delete req.session.portalIcc;

    req.session.save(() =>
      res.json({
        ok: true,
        authenticated: false,
        message: "Sessão Portal ICC encerrada.",
      }),
    );
  });

  router.get("/fields", (_req, res) => {
    res.json({ ok: true, fields: FIELD_OPTIONS });
  });

  router.get("/search", requirePortal, async (req, res, next) => {
    try {
      const result = await req.portalIccClient.searchCdr(req.query || {});
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err?.code === "PORTAL_SESSION_EXPIRED") {
        removePortalIccSession(req);
      }
      next(toPublicError(err));
    }
  });

  router.get("/tasks/search", requirePortal, async (req, res, next) => {
    try {
      const result = await req.portalIccClient.searchTasksByFileRemote(
        req.query || {},
      );
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err?.code === "PORTAL_SESSION_EXPIRED") {
        removePortalIccSession(req);
      }
      next(toPublicError(err));
    }
  });

  router.get("/analytics", requirePortal, async (req, res, next) => {
    try {
      const { export: exportInfo, analytics } = await runCdrAnalytics(
        req.portalIccClient,
        req.query || {},
      );

      return res.json({
        ok: true,
        source: "portal-export",
        downloadedAt: new Date().toISOString(),
        export: exportInfo,
        ...analytics,
      });
    } catch (err) {
      if (err?.code === "PORTAL_SESSION_EXPIRED") {
        removePortalIccSession(req);
      }
      next(toPublicError(err));
    }
  });

  router.post("/analytics/compare", requirePortal, async (req, res, next) => {
    try {
      const leftInput = req.body?.left || {};
      const rightInput = req.body?.right || {};

      const leftResult = await runCdrAnalytics(
        req.portalIccClient,
        leftInput.filters || {},
      );
      const rightResult = await runCdrAnalytics(
        req.portalIccClient,
        rightInput.filters || {},
      );
      const leftLabel =
        String(leftInput.label || "").trim() ||
        activeFilterLabel(leftResult.analytics.filters);
      const rightLabel =
        String(rightInput.label || "").trim() ||
        activeFilterLabel(rightResult.analytics.filters);

      return res.json({
        ok: true,
        source: "portal-export-compare",
        downloadedAt: new Date().toISOString(),
        left: {
          label: leftLabel,
          export: leftResult.export,
          ...leftResult.analytics,
        },
        right: {
          label: rightLabel,
          export: rightResult.export,
          ...rightResult.analytics,
        },
        comparison: buildCdrComparison({
          leftLabel,
          rightLabel,
          left: leftResult.analytics,
          right: rightResult.analytics,
        }),
      });
    } catch (err) {
      if (err?.code === "PORTAL_SESSION_EXPIRED") {
        removePortalIccSession(req);
      }
      next(toPublicError(err));
    }
  });

  return router;
}
