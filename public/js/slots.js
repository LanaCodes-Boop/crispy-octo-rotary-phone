// Scheduling rules shared by the browser and the Node server.
// Dates are "YYYY-MM-DD" and times "HH:MM" in the salon's own timezone,
// so nothing here depends on the visitor's or server's clock settings.

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const toHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const dayNumber = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

export const addDays = (date, n) =>
  new Date((dayNumber(date) + n) * 86400000).toISOString().slice(0, 10);

export const weekdayKey = (date) => WEEKDAYS[new Date(dayNumber(date) * 86400000).getUTCDay()];

export const isValidDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;

export const isValidTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Current date and minute-of-day in the salon's timezone. */
export function nowInZone(timeZone, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function servicesFor(config, ids) {
  const byId = new Map(config.services.map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export const totalMinutes = (services) => services.reduce((sum, s) => sum + s.minutes, 0);
export const totalPrice = (services) => services.reduce((sum, s) => sum + (s.price || 0), 0);

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/**
 * Start times on `date` that can fit an appointment of `minutes`.
 * `bookings` are {date, time, minutes, status}; `blocks` are {date, start?, end?}
 * where a block without start/end closes the whole day.
 */
export function getSlots({ config, date, minutes, bookings = [], blocks = [], now }) {
  const hours = config.hours[weekdayKey(date)];
  if (!hours || !minutes) return [];

  const rules = config.booking;
  const today = now.date;
  const lastDay = addDays(today, rules.maxDaysAhead);
  if (date < today || date > lastDay) return [];

  const dayBlocks = blocks.filter((b) => b.date === date);
  if (dayBlocks.some((b) => !b.start)) return [];

  const buffer = rules.bufferMinutes || 0;
  const busy = [
    ...bookings
      .filter((b) => b.date === date && b.status !== 'cancelled')
      .map((b) => [toMin(b.time), toMin(b.time) + b.minutes + buffer]),
    ...dayBlocks.map((b) => [toMin(b.start), toMin(b.end)]),
  ];

  // Earliest bookable moment, as minutes counted from the start of `date`.
  const earliest = (dayNumber(today) - dayNumber(date)) * 1440 + now.minutes + rules.minNoticeHours * 60;

  const open = toMin(hours[0]);
  const close = toMin(hours[1]);
  const slots = [];
  for (let t = open; t + minutes <= close; t += rules.slotMinutes) {
    if (t < earliest) continue;
    if (busy.some(([s, e]) => overlaps(t, t + minutes + buffer, s, e))) continue;
    slots.push(toHHMM(t));
  }
  return slots;
}

/** Minutes from `now` (as returned by nowInZone) until `date` at `time`; negative once that moment has passed. */
export const minutesUntil = (date, time, now) =>
  (dayNumber(date) - dayNumber(now.date)) * 1440 + toMin(time) - now.minutes;
