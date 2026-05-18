import { Router } from "express";
import SystemSettings from "../models/SystemSettings.js";

const router = Router();

const DEFAULT_CALENDAR = {
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
};

function normalizeWeekdays(values) {
  const source = Array.isArray(values) ? values : DEFAULT_CALENDAR.workingWeekdays;
  const normalized = Array.from(
    new Set(
      source
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
    ),
  ).sort((a, b) => a - b);

  return normalized.length ? normalized : DEFAULT_CALENDAR.workingWeekdays;
}

function normalizeHoliday(holiday) {
  const date = String(holiday?.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  return {
    date,
    name: String(holiday?.name || "").trim().slice(0, 120),
    repeatYearly: Boolean(holiday?.repeatYearly),
    enabled: holiday?.enabled !== false,
  };
}

function normalizeCalendar(calendar) {
  return {
    workingWeekdays: normalizeWeekdays(calendar?.workingWeekdays),
    holidays: (Array.isArray(calendar?.holidays) ? calendar.holidays : [])
      .map(normalizeHoliday)
      .filter(Boolean)
      .slice(0, 500),
  };
}

async function getOrCreateCalendarSettings() {
  const doc = await SystemSettings.findOneAndUpdate(
    { key: "calendar" },
    {
      $setOnInsert: {
        key: "calendar",
        calendar: DEFAULT_CALENDAR,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return normalizeCalendar(doc?.calendar || DEFAULT_CALENDAR);
}

router.get("/calendar", async (_req, res, next) => {
  try {
    const calendar = await getOrCreateCalendarSettings();
    res.json({ ok: true, calendar });
  } catch (err) {
    next(err);
  }
});

router.put("/calendar", async (req, res, next) => {
  try {
    const calendar = normalizeCalendar(req.body?.calendar || req.body || {});
    const updatedBy = String(
      req.user?.email || req.headers["x-user-email"] || "",
    ).trim();

    const doc = await SystemSettings.findOneAndUpdate(
      { key: "calendar" },
      {
        $set: {
          calendar,
          updatedBy,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    res.json({
      ok: true,
      calendar: normalizeCalendar(doc?.calendar || calendar),
      updatedAt: doc?.updatedAt || null,
      updatedBy: doc?.updatedBy || "",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
