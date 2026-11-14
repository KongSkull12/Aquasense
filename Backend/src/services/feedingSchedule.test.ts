import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveScheduleDate, feedingCalendarDate } from './feedingService';

test('feedingCalendarDate is YYYY-MM-DD in Asia/Manila', () => {
  const stamp = new Date('2026-11-13T16:30:00.000Z'); // already 14 Nov morning in Manila
  assert.equal(feedingCalendarDate(stamp, 'Asia/Manila'), '2026-11-14');
});

test('past one-time schedule dates become daily (null)', () => {
  const now = new Date('2026-11-14T12:00:00.000Z');
  assert.equal(effectiveScheduleDate('2024-11-13', now), null);
  assert.equal(effectiveScheduleDate('2026-11-13', now), null);
  assert.equal(effectiveScheduleDate(null, now), null);
  assert.equal(effectiveScheduleDate('', now), null);
});

test('today and future one-time dates are kept', () => {
  const now = new Date('2026-11-13T16:30:00.000Z'); // Manila 2026-11-14
  assert.equal(effectiveScheduleDate('2026-11-14', now), '2026-11-14');
  assert.equal(effectiveScheduleDate('2026-12-01', now), '2026-12-01');
});
