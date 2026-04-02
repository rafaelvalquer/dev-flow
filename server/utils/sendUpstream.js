// server/utils/sendUpstream.js
import { AppError, readResponseBody, sendError } from "./http.js";

export async function sendUpstream(
  res,
  response,
  fallbackType = "application/json",
  context = {}
) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) res.setHeader("Retry-After", retryAfter);

  if (!response.ok) {
    const body = await readResponseBody(response).catch(() => null);
    return sendError(
      res,
      new AppError({
        status: response.status >= 500 ? 502 : response.status,
        code: "UPSTREAM_ERROR",
        message:
          context.message ||
          `Falha na comunicação com ${context.service || "serviço externo"}.`,
        details: {
          service: context.service || "upstream",
          upstreamStatus: response.status,
          upstreamBody: body,
        },
      })
    );
  }

  res.status(response.status);

  const ct = response.headers.get("content-type") || fallbackType;
  res.type(ct);

  const text = await response.text();
  return res.send(text);
}
