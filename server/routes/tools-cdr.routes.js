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
      ? "Sessao Portal ICC expirada. Faca login novamente."
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
        message: "Sessao Portal ICC encerrada.",
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

  router.get("/analytics", requirePortal, async (req, res, next) => {
    try {
      const dataInicial = String(req.query?.dataInicial || "").slice(0, 10);
      const dataFinal = String(req.query?.dataFinal || "").slice(0, 10);
      const segmento = String(req.query?.segmento || "").trim();

      const exported = await req.portalIccClient.exportCdrCsv({
        dataInicial,
        dataFinal,
        segmento,
      });
      const analytics = analyzeCdrCsv(exported.csvText, {
        dataInicial,
        dataFinal,
        segmento,
      });

      return res.json({
        ok: true,
        source: "portal-export",
        downloadedAt: new Date().toISOString(),
        export: {
          bytes: exported.bytes,
          contentType: exported.contentType,
          filename: exported.filename,
          filters: exported.filters,
        },
        ...analytics,
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
