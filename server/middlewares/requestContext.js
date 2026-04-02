import crypto from "node:crypto";
import { createRequestLogger } from "../utils/http.js";

export function requestContext(req, res, next) {
  const requestId =
    String(req.headers["x-request-id"] || "").trim() || crypto.randomUUID();

  req.id = requestId;
  req.log = createRequestLogger(req);
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  req.log("info", "request.start");

  res.on("finish", () => {
    req.log("info", "request.finish", {
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
}
