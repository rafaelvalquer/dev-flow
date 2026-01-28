// server/utils/sendUpstream.js
export function sendUpstream(res, r, fallbackType = "application/json") {
  res.status(r.status);

  const ct = r.headers.get("content-type") || fallbackType;
  res.type(ct);

  const ra = r.headers.get("retry-after");
  if (ra) res.setHeader("Retry-After", ra);

  return r.text().then((t) => res.send(t));
}
