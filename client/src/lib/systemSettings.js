import {
  DEFAULT_CALENDAR_SETTINGS,
  normalizeCalendarSettings,
} from "@/utils/businessCalendar";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
        payload?.error?.message ||
        payload?.message ||
        payload?.error ||
        "Não foi possível carregar a configuração.",
    );
  }
  return payload;
}

export async function fetchCalendarSettings() {
  const response = await fetch("/api/settings/calendar");
  const payload = await readJsonResponse(response);
  return normalizeCalendarSettings(
    payload?.calendar || payload || DEFAULT_CALENDAR_SETTINGS,
  );
}

export async function saveCalendarSettings(calendar) {
  const response = await fetch("/api/settings/calendar", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      calendar: normalizeCalendarSettings(calendar),
    }),
  });
  const payload = await readJsonResponse(response);
  return normalizeCalendarSettings(
    payload?.calendar || payload || DEFAULT_CALENDAR_SETTINGS,
  );
}
