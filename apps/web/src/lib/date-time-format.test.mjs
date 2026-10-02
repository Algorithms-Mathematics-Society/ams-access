import test from 'node:test';
import assert from 'node:assert/strict';
import { dateTimeFormatter, refreshDateTimeFormatEnvironment } from './date-time-format.ts';
test('reuses equivalent options and preserves locale and timezone formatting', () => {
  const a = { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' };
  assert.equal(dateTimeFormatter(a), dateTimeFormatter({ timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }));
  const date = new Date('2026-10-02T23:30:00Z');
  assert.equal(dateTimeFormatter(a).format(date), new Intl.DateTimeFormat(undefined, a).format(date));
  assert.notEqual(dateTimeFormatter(a), dateTimeFormatter({ ...a, timeZone: 'UTC' }));
});
test('cache is bounded rather than retaining every organizer timezone', () => {
  const original = dateTimeFormatter({ timeZone: 'UTC', hour: 'numeric' });
  for (const timeZone of Intl.supportedValuesOf('timeZone').slice(0, 40)) dateTimeFormatter({ timeZone, hour: 'numeric' });
  assert.notEqual(dateTimeFormatter({ timeZone: 'UTC', hour: 'numeric' }), original);
});

test('local formatters refresh after timezone changes, including equal-offset zones', (t) => {
  const previous = process.env.TZ;
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; refreshDateTimeFormatEnvironment(); });
  process.env.TZ = 'UTC'; refreshDateTimeFormatEnvironment();
  const utc = dateTimeFormatter({ hour: 'numeric', minute: '2-digit' });
  process.env.TZ = 'Asia/Kolkata';
  const changed = dateTimeFormatter({ hour: 'numeric', minute: '2-digit' });
  assert.notEqual(changed, utc);
  assert.equal(changed.resolvedOptions().timeZone, new Intl.DateTimeFormat().resolvedOptions().timeZone);
  process.env.TZ = 'Europe/London'; refreshDateTimeFormatEnvironment();
  const london = dateTimeFormatter({ timeZoneName: 'long' });
  process.env.TZ = 'Africa/Lagos'; refreshDateTimeFormatEnvironment();
  assert.notEqual(dateTimeFormatter({ timeZoneName: 'long' }), london);
});
