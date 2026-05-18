import User from "../models/User.js";

export function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id || user.id || ""),
    name: user.name || "",
    email: user.email || "",
    role: user.role || "user",
    jiraAccountId: user.jiraAccountId || "",
    lastLoginAt: user.lastLoginAt || null,
  };
}

export async function attachUser(req, _res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) return next();

    const user = await User.findById(userId);
    if (user) req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({
    error: {
      code: "AUTH_REQUIRED",
      message: "Login obrigatorio para acessar este recurso.",
    },
  });
}
