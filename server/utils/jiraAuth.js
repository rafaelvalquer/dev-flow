// server/utils/jiraAuth.js
export function makeJiraHeaders({ email, token }, extra = {}) {
  const basic = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    Accept: "application/json",
    ...extra,
  };
}
