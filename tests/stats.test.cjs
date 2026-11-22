const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const time = require('../src/stats/time');

const zone = 'Europe/Istanbul';
const day = (y, m, d) => time.civilDayFromDate(y, m, d);

test('snowflakes convert to and from timestamps', () => {
  // Discord documentation example: 175928847299117063 -> 2016-04-30T11:18:25.796Z
  assert.equal(time.snowflakeToMs('175928847299117063'), Date.parse('2016-04-30T11:18:25.796Z'));
  const ms = Date.parse('2024-01-01T00:00:00Z');
  assert.equal(time.snowflakeToMs(time.msToSnowflake(ms)), ms);
  assert.equal(time.msToSnowflake(0), 0n);
});

test('local days follow the statistics time zone, not UTC', () => {
  // 22:30 UTC on 31 Dec is already 1 Jan in Istanbul (UTC+3).
  assert.equal(time.civilDayOf(Date.parse('2023-12-31T22:30:00Z'), zone), day(2024, 1, 1));
  assert.equal(time.civilDayOf(Date.parse('2023-12-31T20:30:00Z'), zone), day(2023, 12, 31));
  assert.equal(time.civilDayStartMs(day(2024, 1, 1), zone), Date.parse('2023-12-31T21:00:00Z'));
  // DST zone: midnight in Berlin during summer time is 22:00 UTC.
  assert.equal(time.civilDayStartMs(day(2024, 7, 1), 'Europe/Berlin'), Date.parse('2024-06-30T22:00:00Z'));
});

test('hour buckets fold into local days, weeks, months and years', () => {
  const hour = iso => Date.parse(iso) / 3600000;
  const hours = new Map([
    [hour('2024-03-03T20:00:00Z'), 2], // Sunday 23:00 Istanbul
    [hour('2024-03-03T21:00:00Z'), 5], // Monday 00:00 Istanbul
    [hour('2024-03-31T22:00:00Z'), 1], // 1 April Istanbul
  ]);
  const days = time.hoursToDays(hours, zone);
  assert.equal(days.get(day(2024, 3, 3)), 2);
  assert.equal(days.get(day(2024, 3, 4)), 5);
  const weeks = time.daysToBuckets(days, 'week');
  assert.equal(weeks.get(day(2024, 2, 26)), 2); // week starting Monday 26 Feb
  assert.equal(weeks.get(day(2024, 3, 4)), 5);
  const months = time.daysToBuckets(days, 'month');
  assert.equal(months.get(day(2024, 3, 1)), 7);
  assert.equal(months.get(day(2024, 4, 1)), 1);
  assert.equal(time.daysToBuckets(days, 'year').get(day(2024, 1, 1)), 8);
});

test('bucket sequences include empty periods', () => {
  assert.equal(time.bucketStarts(day(2024, 1, 1), day(2024, 1, 31), 'day').length, 31);
  assert.deepEqual(time.bucketStarts(day(2024, 1, 15), day(2024, 3, 2), 'month'),
    [day(2024, 1, 1), day(2024, 2, 1), day(2024, 3, 1)]);
  assert.equal(time.bucketStarts(day(2020, 6, 1), day(2024, 2, 1), 'year').length, 5);
  assert.equal(time.bucketStarts(day(2024, 1, 3), day(2024, 1, 14), 'week')[0], day(2024, 1, 1));
  assert.equal(time.bucketStarts(day(2000, 1, 1), day(2024, 1, 1), 'day', 10).length, 11);
});

test('date inputs accept day, month and year forms', () => {
  assert.deepEqual(time.parseDateInput('2024-03-15'), { first: day(2024, 3, 15), last: day(2024, 3, 15) });
  assert.deepEqual(time.parseDateInput('15.03.2024'), { first: day(2024, 3, 15), last: day(2024, 3, 15) });
  assert.deepEqual(time.parseDateInput('15/3/2024'), { first: day(2024, 3, 15), last: day(2024, 3, 15) });
  assert.deepEqual(time.parseDateInput('2024-02'), { first: day(2024, 2, 1), last: day(2024, 2, 29) });
  assert.deepEqual(time.parseDateInput('02.2023'), { first: day(2023, 2, 1), last: day(2023, 2, 28) });
  assert.deepEqual(time.parseDateInput('2023'), { first: day(2023, 1, 1), last: day(2023, 12, 31) });
  assert.equal(time.parseDateInput('31.02.2024'), null);
  assert.equal(time.parseDateInput('dün'), null);
});

test('ranges resolve presets and custom dates in local time', () => {
  const nowMs = Date.parse('2024-05-15T12:00:00Z'); // Wednesday
  const base = { nowMs, earliestMs: Date.parse('2021-07-01T10:00:00Z'), zone };
  const last30 = time.resolveRange({ ...base, preset: '30d' });
  assert.equal(last30.lastDay - last30.firstDay + 1, 30);
  assert.equal(last30.endMs, nowMs + 1);
  assert.equal(time.resolveRange({ ...base, preset: 'this-week' }).firstDay, day(2024, 5, 13));
  assert.equal(time.resolveRange({ ...base, preset: 'this-month' }).firstDay, day(2024, 5, 1));
  assert.equal(time.resolveRange({ ...base, preset: 'this-year' }).firstDay, day(2024, 1, 1));
  const all = time.resolveRange({ ...base, preset: 'all' });
  assert.equal(all.firstDay, day(2021, 7, 1));
  assert.equal(all.isAllTime, true);

  const custom = time.resolveRange({ ...base, from: '2024-01', to: '2024-02' });
  assert.equal(custom.firstDay, day(2024, 1, 1));
  assert.equal(custom.lastDay, day(2024, 2, 29));
  assert.equal(custom.startMs, Date.parse('2023-12-31T21:00:00Z'));
  assert.equal(custom.endMs, Date.parse('2024-02-29T21:00:00Z'));
  // Open-ended ranges stop today and start at the earliest data.
  assert.equal(time.resolveRange({ ...base, from: '2024-05-01' }).lastDay, day(2024, 5, 15));
  assert.equal(time.resolveRange({ ...base, to: '2022' }).firstDay, day(2021, 7, 1));

  assert.throws(() => time.resolveRange({ ...base, from: '2024-03-01', to: '2024-02-01' }), time.StatsInputError);
  assert.throws(() => time.resolveRange({ ...base, from: '2030' }), time.StatsInputError);
  assert.throws(() => time.resolveRange({ ...base, from: 'abc' }), /anlaşılamadı/);
});

test('automatic interval keeps charts readable', () => {
  assert.equal(time.autoInterval(30), 'day');
  assert.equal(time.autoInterval(365), 'week');
  assert.equal(time.autoInterval(1500), 'month');
  assert.equal(time.autoInterval(5000), 'year');
});

test('Turkish labels', () => {
  assert.equal(time.formatDay(day(2024, 3, 4)), '4 Mart 2024');
  assert.equal(time.formatWeekday(day(2024, 3, 4)), 'Pazartesi');
  assert.equal(time.bucketLabel(day(2024, 3, 1), 'year', false), '2024');
  assert.match(time.bucketLabel(day(2024, 11, 1), 'month', false), /Kas/);
});

test('charts render as PNG images', () => {
  const chart = require('../src/stats/chart');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const series = chart.renderTimeSeries({ title: 'Test', subtitle: 'Son 30 gün', labels: ['1 Oca', '2 Oca'], values: [3, 12], highlightIndex: 1 });
  assert.deepEqual(series.subarray(0, 4), png);
  const long = chart.renderTimeSeries({ title: 'Uzun', labels: Array.from({ length: 400 }, (_, i) => String(i)), values: Array.from({ length: 400 }, (_, i) => i % 50) });
  assert.deepEqual(long.subarray(0, 4), png);
  const ranking = chart.renderRanking({ title: 'Sıralama', labels: ['Çağrı', 'Şule', 'Ömer'], values: [30, 20, 10] });
  assert.deepEqual(ranking.subarray(0, 4), png);
  assert.equal(chart.formatNumber(12345), '12.345');
});

test('system messages are not counted and thread messages belong to the parent channel', () => {
  const { toLoggedMessage } = require('../src/stats/service');
  const author = { id: '42', bot: false, username: 'kullanici' };
  const base = { id: '1000', guildId: '1', channelId: '200', author, system: false, webhookId: null, channel: { type: 0 } };
  assert.deepEqual(toLoggedMessage(base), { id: '1000', channelId: '200', authorId: '42', isBot: false, syncId: '200' });
  assert.equal(toLoggedMessage({ ...base, system: true }), null);
  assert.equal(toLoggedMessage({ ...base, guildId: null }), null);
  const thread = toLoggedMessage({ ...base, channelId: '300', channel: { type: 11, parentId: '200' } });
  assert.equal(thread.channelId, '200');
  assert.equal(thread.syncId, '300');
  assert.equal(toLoggedMessage({ ...base, webhookId: '9' }).isBot, true);
});

test('a failed live flush is retried and does not resurrect deleted messages', async () => {
  const { MessageStatsService } = require('../src/stats/service');
  const inserted = [];
  let fail = true;
  const prisma = {
    $executeRaw: async (strings, ...values) => {
      if (fail) throw new Error('database is locked');
      // Prisma.join() nests the row values inside a Sql object.
      inserted.push(...values.flatMap(value => value?.values ?? [value]));
      return 1;
    },
    messageLog: { deleteMany: async () => ({ count: 0 }) },
  };
  const service = new MessageStatsService(prisma);
  const author = { id: '42', bot: false, username: 'u', globalName: null };
  const message = id => ({ id, guildId: '1', channelId: '200', author, system: false, webhookId: null, channel: { type: 0 }, member: null });
  service.record(message('1001'));
  service.record(message('1002'));
  await service.flush();
  assert.ok(service.flushTimer, 'a retry is scheduled after a failed flush');
  await service.forget(['1001']);
  fail = false;
  await service.flush();
  const ids = inserted.map(String);
  assert.ok(ids.includes('1002'));
  assert.ok(!ids.includes('1001'), 'deleted message must not be inserted on retry');
  clearTimeout(service.flushTimer);
});

test('dates before Discord existed are rejected', () => {
  assert.equal(time.parseDateInput('0024'), null);
  assert.equal(time.parseDateInput('24.03.0099'), null);
  assert.equal(time.parseDateInput('2014-12'), null);
  assert.ok(time.parseDateInput('2015'));
});

test('invalid date errors do not echo backticks', () => {
  assert.throws(() => time.resolveRange({ from: '`@everyone`', nowMs: Date.now(), earliestMs: 0, zone: 'UTC' }),
    error => !error.message.includes('`@everyone`') && error.message.includes("'@everyone'"));
});
