import User from "../models/User.js";

const DEFAULT_PREFERENCES = {
  theme: "claro",
  defaultTab: "gmud",
  sidebarCollapsed: false,
};

const VALID_THEMES = new Set(["claro", "grafite", "oceano", "verde"]);

function publicPreferences(preferences = {}) {
  const theme = preferences.theme === "light" ? "claro" : preferences.theme;
  return {
    theme: VALID_THEMES.has(theme)
      ? theme
      : DEFAULT_PREFERENCES.theme,
    defaultTab: preferences.defaultTab || DEFAULT_PREFERENCES.defaultTab,
    sidebarCollapsed: Boolean(preferences.sidebarCollapsed),
  };
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id || user.id || ""),
    name: user.name || "",
    email: user.email || "",
    role: user.role || "user",
    jiraAccountId: user.jiraAccountId || "",
    jiraTokenUpdatedAt: user.jiraTokenUpdatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    preferences: publicPreferences(user.preferences),
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
