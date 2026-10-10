import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, getSlots, isValidDate, nowInZone, weekdayKey } from '../public/js/slots.js';

const config = {
  hours: { mon: null, tue: ['09:00', '12:00'], wed: ['09:00', '12:00'], thu: null, fri: null, sat: null, sun: null },
  booking: { slotMinutes: 30, minNoticeHours: 2, maxDaysAhead: 30, bufferMinutes: 0 },
};
const TUESDAY = '2026-10-13';
const before = { date: '2026-10-12', minutes: 8 * 60 }; // Monday 08:00

test('date helpers', () => {
  assert.equal(weekdayKey(TUESDAY), 'tue');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.equal(nowInZone('America/Paramaribo', new Date('2026-10-10T02:30:00Z')).date, '2026-10-09');
});

test('slots fill opening hours and respect duration', () => {
  assert.deepEqual(getSlots({ config, date: TUESDAY, minutes: 60, now: before }), ['09:00', '09:30', '10:00', '10:30', '11:00']);
  assert.deepEqual(getSlots({ config, date: TUESDAY, minutes: 180, now: before }), ['09:00']);
  assert.deepEqual(getSlots({ config, date: TUESDAY, minutes: 181, now: before }), []);
});

test('closed days, past days and days too far ahead have no slots', () => {
  assert.deepEqual(getSlots({ config, date: '2026-10-12', minutes: 30, now: before }), []);
  assert.deepEqual(getSlots({ config, date: '2026-10-06', minutes: 30, now: before }), []);
  assert.deepEqual(getSlots({ config, date: '2026-11-17', minutes: 30, now: before }), []);
});

test('minimum notice applies, including across midnight', () => {
  const now = { date: TUESDAY, minutes: 9 * 60 + 10 };
  assert.deepEqual(getSlots({ config, date: TUESDAY, minutes: 30, now }), ['11:30']);
  const lateMonday = { date: '2026-10-12', minutes: 23 * 60 + 30 };
  const longNotice = { ...config, booking: { ...config.booking, minNoticeHours: 10 } };
  assert.equal(getSlots({ config: longNotice, date: TUESDAY, minutes: 30, now: lateMonday })[0], '09:30');
});

test('existing bookings and time off block overlapping slots', () => {
  const bookings = [
    { date: TUESDAY, time: '10:00', minutes: 60, status: 'pending' },
    { date: TUESDAY, time: '09:00', minutes: 30, status: 'cancelled' },
  ];
  assert.deepEqual(getSlots({ config, date: TUESDAY, minutes: 60, bookings, now: before }), ['09:00', '11:00']);

  const blocks = [{ date: TUESDAY, start: '11:00', end: '12:00' }];
  assert.deepEqual(getSlots({ config, date: TUESDAY, minutes: 60, bookings, blocks, now: before }), ['09:00']);
  assert.deepEqual(getSlots({ config, date: TUESDAY, minutes: 30, blocks: [{ date: TUESDAY }], now: before }), []);
});

test('buffer time is kept between appointments', () => {
  const withBuffer = { ...config, booking: { ...config.booking, bufferMinutes: 15 } };
  const bookings = [{ date: TUESDAY, time: '10:00', minutes: 30, status: 'confirmed' }];
  assert.deepEqual(getSlots({ config: withBuffer, date: TUESDAY, minutes: 30, bookings, now: before }), ['09:00', '11:00', '11:30']);
});
