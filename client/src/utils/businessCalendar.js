export const DEFAULT_CALENDAR_SETTINGS = {
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
};

export const WEEKDAY_LABELS = [
  { value: 0, short: "Dom", label: "Domingo" },
  { value: 1, short: "Seg", label: "Segunda" },
  { value: 2, short: "Ter", label: "Terça" },
  { value: 3, short: "Qua", label: "Quarta" },
  { value: 4, short: "Qui", label: "Quinta" },
  { value: 5, short: "Sex", label: "Sexta" },
  { value: 6, short: "Sábado", label: "Sábado" },
];

export function toLocalDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = String(value || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function toYMDLocal(value) {
  const date = toLocalDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeCalendarSettings(raw) {
  const weekdays = Array.isArray(raw?.workingWeekdays)
    ? raw.workingWeekdays
    : DEFAULT_CALENDAR_SETTINGS.workingWeekdays;

  const workingWeekdays = Array.from(
    new Set(
      weekdays
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
    ),
  ).sort((a, b) => a - b);

  const holidays = (Array.isArray(raw?.holidays) ? raw.holidays : [])
    .map((holiday) => ({
      date: toYMDLocal(holiday?.date),
      name: String(holiday?.name || "").trim(),
      repeatYearly: Boolean(holiday?.repeatYearly),
      enabled: holiday?.enabled !== false,
    }))
    .filter((holiday) => holiday.date);

  return {
    workingWeekdays: workingWeekdays.length
      ? workingWeekdays
      : DEFAULT_CALENDAR_SETTINGS.workingWeekdays,
    holidays,
  };
}

export function addCalendarDays(value, amount) {
  const date = toLocalDate(value);
  if (!date) return null;
  const next = new Date(date);
  next.setDate(next.getDate() + Number(amount || 0));
  return next;
}

export function findHolidayForDate(value, settings = DEFAULT_CALENDAR_SETTINGS) {
  const date = toLocalDate(value);
  if (!date) return null;

  const normalized = normalizeCalendarSettings(settings);
  const ymd = toYMDLocal(date);
  const mmdd = ymd.slice(5);

  return (
    normalized.holidays.find((holiday) => {
      if (!holiday.enabled) return false;
      if (holiday.repeatYearly) return holiday.date.slice(5) === mmdd;
      return holiday.date === ymd;
    }) || null
  );
}

export function isWorkingDay(value, settings = DEFAULT_CALENDAR_SETTINGS) {
  const date = toLocalDate(value);
  if (!date) return false;

  const normalized = normalizeCalendarSettings(settings);
  if (!normalized.workingWeekdays.includes(date.getDay())) return false;
  return !findHolidayForDate(date, normalized);
}

export function nextWorkingDay(
  value,
  settings = DEFAULT_CALENDAR_SETTINGS,
  options = {},
) {
  const start = toLocalDate(value);
  if (!start) return null;

  const includeCurrent = options.includeCurrent !== false;
  let cursor = includeCurrent ? start : addCalendarDays(start, 1);

  for (let guard = 0; guard < 3700; guard += 1) {
    if (isWorkingDay(cursor, settings)) return cursor;
    cursor = addCalendarDays(cursor, 1);
  }

  return cursor;
}

export function addBusinessDays(
  start,
  amount,
  settings = DEFAULT_CALENDAR_SETTINGS,
) {
  const total = Math.max(1, parseInt(String(amount || 1), 10) || 1);
  let cursor = toLocalDate(start);
  if (!cursor) return null;

  let counted = 1;
  while (counted < total) {
    cursor = nextWorkingDay(addCalendarDays(cursor, 1), settings, {
      includeCurrent: true,
    });
    counted += 1;
  }

  return cursor;
}

export function businessDurationDays(
  start,
  end,
  settings = DEFAULT_CALENDAR_SETTINGS,
) {
  const first = toLocalDate(start);
  const last = toLocalDate(end);
  if (!first || !last) return 1;

  const min = first <= last ? first : last;
  const max = first <= last ? last : first;
  let cursor = addCalendarDays(min, 1);
  let count = 1;

  for (let guard = 0; cursor <= max && guard < 3700; guard += 1) {
    if (isWorkingDay(cursor, settings)) count += 1;
    cursor = addCalendarDays(cursor, 1);
  }

  return Math.max(1, count);
}

export function containsNonWorkingDays(
  start,
  end,
  settings = DEFAULT_CALENDAR_SETTINGS,
) {
  const first = toLocalDate(start);
  const last = toLocalDate(end);
  if (!first || !last) return false;

  let cursor = first <= last ? first : last;
  const max = first <= last ? last : first;

  for (let guard = 0; cursor <= max && guard < 3700; guard += 1) {
    if (!isWorkingDay(cursor, settings)) return true;
    cursor = addCalendarDays(cursor, 1);
  }

  return false;
}

export function formatWorkingWeekdays(settings = DEFAULT_CALENDAR_SETTINGS) {
  const normalized = normalizeCalendarSettings(settings);
  const values = normalized.workingWeekdays;

  if (values.join(",") === "1,2,3,4,5") return "Seg-Sex";
  if (values.length === 7) return "Todos os dias";
  return WEEKDAY_LABELS.filter((day) => values.includes(day.value))
    .map((day) => day.short)
    .join(", ");
}

export function countActiveHolidays(settings = DEFAULT_CALENDAR_SETTINGS) {
  return normalizeCalendarSettings(settings).holidays.filter(
    (holiday) => holiday.enabled,
  ).length;
}
