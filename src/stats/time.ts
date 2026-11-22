// Pure date helpers for message statistics. No Discord or database access here.
//
// A "civil day" is the number of days since 1970-01-01 for a calendar date in the
// configured statistics time zone. Working with civil days keeps daily, weekly,
// monthly and yearly buckets independent from the host machine's time zone.

export const DISCORD_EPOCH = 1420070400000;
const DAY_MS = 86400000;
const HOUR_MS = 3600000;

export type Interval = 'day' | 'week' | 'month' | 'year';
export type RangePreset = 'today' | '7d' | '30d' | '90d' | '365d' | 'this-week' | 'this-month' | 'this-year' | 'all';

export const statsTimeZone = (): string => {
	const zone = process.env.STATS_TIMEZONE || 'Europe/Istanbul';
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return zone;
	}
	catch {
		return 'Europe/Istanbul';
	}
};

// ---------------------------------------------------------------------------
// Snowflakes
// ---------------------------------------------------------------------------
export const snowflakeToMs = (id: string | bigint): number => Number((BigInt(id) >> 22n) + BigInt(DISCORD_EPOCH));

// Smallest snowflake that can belong to a message sent at or after `ms`.
export const msToSnowflake = (ms: number): bigint => {
	const offset = Math.max(0, Math.floor(ms) - DISCORD_EPOCH);
	return BigInt(offset) << 22n;
};

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------
const formatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatter = (zone: string) => {
	let formatter = formatters.get(zone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: zone, hourCycle: 'h23',
			year: 'numeric', month: 'numeric', day: 'numeric',
			hour: 'numeric', minute: 'numeric', second: 'numeric',
		});
		formatters.set(zone, formatter);
	}
	return formatter;
};

const zonedParts = (ms: number, zone: string) => {
	const values: Record<string, number> = {};
	for (const part of partsFormatter(zone).formatToParts(new Date(ms))) {
		if (part.type !== 'literal') values[part.type] = Number(part.value);
	}
	return values;
};

// Local wall-clock time minus UTC, in milliseconds.
export const zoneOffsetMs = (ms: number, zone: string): number => {
	const p = zonedParts(ms, zone);
	const local = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
	return local - Math.floor(ms / 1000) * 1000;
};

export const civilDayOf = (ms: number, zone: string): number => {
	const p = zonedParts(ms, zone);
	return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
};

// UTC instant of local midnight at the start of a civil day.
export const civilDayStartMs = (day: number, zone: string): number => {
	const guess = day * DAY_MS;
	let result = guess - zoneOffsetMs(guess, zone);
	const corrected = guess - zoneOffsetMs(result, zone);
	if (corrected !== result) result = corrected;
	return result;
};

export const civilDate = (day: number) => {
	const date = new Date(day * DAY_MS);
	return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
};

export const civilDayFromDate = (year: number, month: number, day: number): number =>
	Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------
export const bucketStart = (day: number, interval: Interval): number => {
	const date = civilDate(day);
	switch (interval) {
		case 'week': return day - ((date.weekday + 6) % 7); // Monday
		case 'month': return civilDayFromDate(date.year, date.month, 1);
		case 'year': return civilDayFromDate(date.year, 1, 1);
		default: return day;
	}
};

export const nextBucket = (start: number, interval: Interval): number => {
	const date = civilDate(start);
	switch (interval) {
		case 'week': return start + 7;
		case 'month': return civilDayFromDate(date.year, date.month + 1, 1);
		case 'year': return civilDayFromDate(date.year + 1, 1, 1);
		default: return start + 1;
	}
};

export const bucketStarts = (firstDay: number, lastDay: number, interval: Interval, limit = Infinity): number[] => {
	const starts: number[] = [];
	for (let day = bucketStart(firstDay, interval); day <= lastDay; day = nextBucket(day, interval)) {
		starts.push(day);
		if (starts.length > limit) break;
	}
	return starts;
};

// Folds UTC hour buckets (as returned by the database) into local civil days.
export const hoursToDays = (hours: Map<number, number>, zone: string): Map<number, number> => {
	const days = new Map<number, number>();
	for (const [hour, count] of hours) {
		const day = civilDayOf(hour * HOUR_MS, zone);
		days.set(day, (days.get(day) ?? 0) + count);
	}
	return days;
};

export const daysToBuckets = (days: Map<number, number>, interval: Interval): Map<number, number> => {
	const buckets = new Map<number, number>();
	for (const [day, count] of days) {
		const start = bucketStart(day, interval);
		buckets.set(start, (buckets.get(start) ?? 0) + count);
	}
	return buckets;
};

// Busiest days first; ties go to the earlier day.
export const rankDays = (days: Map<number, number>, limit: number): [number, number][] =>
	[...days].filter(([, count]) => count > 0)
		.sort((a, b) => b[1] - a[1] || a[0] - b[0])
		.slice(0, limit);

// Picks a readable granularity for a span when the user did not choose one.
export const autoInterval = (spanDays: number): Interval => {
	if (spanDays <= 92) return 'day';
	if (spanDays <= 731) return 'week';
	if (spanDays <= 3660) return 'month';
	return 'year';
};

// ---------------------------------------------------------------------------
// Labels (Turkish)
// ---------------------------------------------------------------------------
const labelFormat = (options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', ...options });
const shortDay = labelFormat({ day: 'numeric', month: 'short' });
const shortDayYear = labelFormat({ day: 'numeric', month: 'short', year: 'numeric' });
const monthYear = labelFormat({ month: 'short', year: 'numeric' });
const longDay = labelFormat({ day: 'numeric', month: 'long', year: 'numeric' });
const weekdayName = labelFormat({ weekday: 'long' });

export const bucketLabel = (start: number, interval: Interval, withYear: boolean): string => {
	const date = new Date(start * DAY_MS);
	switch (interval) {
		case 'year': return String(date.getUTCFullYear());
		case 'month': return monthYear.format(date);
		default: return (withYear ? shortDayYear : shortDay).format(date);
	}
};

export const formatDay = (day: number): string => longDay.format(new Date(day * DAY_MS));
export const formatWeekday = (day: number): string => weekdayName.format(new Date(day * DAY_MS));

export const formatBucketRange = (start: number, interval: Interval): string => {
	if (interval === 'day') return formatDay(start);
	if (interval === 'week') return formatDay(start) + ' – ' + formatDay(start + 6);
	return bucketLabel(start, interval, true);
};

export const intervalNames: Record<Interval, string> = {
	day: 'Günlük', week: 'Haftalık', month: 'Aylık', year: 'Yıllık',
};
export const intervalUnits: Record<Interval, string> = {
	day: 'gün', week: 'hafta', month: 'ay', year: 'yıl',
};

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------
export interface DateSpan { first: number; last: number; }

// Accepts 2024-03-15, 15.03.2024, 15/03/2024, 2024-03, 03.2024 and 2024.
export const parseDateInput = (input: string): DateSpan | null => {
	const text = input.trim();
	let match: RegExpMatchArray | null;
	// Discord did not exist before 2015; this also stops Date.UTC mapping 0-99 to 1900-1999.
	const validYear = (year: number) => year >= 2015 && year <= 9999;
	const valid = (y: number, m: number, d: number) => {
		if (!validYear(y)) return null;
		const day = civilDayFromDate(y, m, d);
		const check = civilDate(day);
		return check.year === y && check.month === m && check.day === d ? day : null;
	};
	if ((match = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/))) {
		const day = valid(+match[1], +match[2], +match[3]);
		return day === null ? null : { first: day, last: day };
	}
	if ((match = text.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/))) {
		const day = valid(+match[3], +match[2], +match[1]);
		return day === null ? null : { first: day, last: day };
	}
	const month = (y: number, m: number): DateSpan | null => {
		if (m < 1 || m > 12 || !validYear(y)) return null;
		return { first: civilDayFromDate(y, m, 1), last: civilDayFromDate(y, m + 1, 1) - 1 };
	};
	if ((match = text.match(/^(\d{4})[-./](\d{1,2})$/))) return month(+match[1], +match[2]);
	if ((match = text.match(/^(\d{1,2})[-./](\d{4})$/))) return month(+match[2], +match[1]);
	if ((match = text.match(/^(\d{4})$/))) {
		const year = +match[1];
		if (!validYear(year)) return null;
		return { first: civilDayFromDate(year, 1, 1), last: civilDayFromDate(year, 12, 31) };
	}
	return null;
};

export const presetNames: Record<RangePreset, string> = {
	'today': 'Bugün',
	'7d': 'Son 7 gün',
	'30d': 'Son 30 gün',
	'90d': 'Son 90 gün',
	'365d': 'Son 1 yıl',
	'this-week': 'Bu hafta',
	'this-month': 'Bu ay',
	'this-year': 'Bu yıl',
	'all': 'Tüm zamanlar',
};

export interface RangeRequest {
	preset?: RangePreset | null;
	from?: string | null;
	to?: string | null;
	nowMs: number;
	// First day that can contain data, used for "all" and open-ended ranges.
	earliestMs: number;
	zone: string;
}

export interface ResolvedRange {
	firstDay: number;
	lastDay: number;
	startMs: number;
	endMs: number; // exclusive
	label: string;
	isAllTime: boolean;
	custom: boolean; // from/to dates were given; the label already shows the dates
}

export class StatsInputError extends Error {}

// User input shown back inside `code`: no backticks, bounded length.
const quoteInput = (input: string) => input.replace(/`/g, '\'').slice(0, 40);

export const resolveRange = (request: RangeRequest): ResolvedRange => {
	const { zone, nowMs } = request;
	const today = civilDayOf(nowMs, zone);
	const earliest = Math.min(civilDayOf(request.earliestMs, zone), today);
	let firstDay: number;
	let lastDay = today;
	let label: string;
	let isAllTime = false;

	if (request.from || request.to) {
		const from = request.from ? parseDateInput(request.from) : null;
		const to = request.to ? parseDateInput(request.to) : null;
		if (request.from && !from) throw new StatsInputError('Başlangıç tarihi anlaşılamadı: `' + quoteInput(request.from) + '`. Örnek: 2024-03-15, 15.03.2024, 2024-03 veya 2024.');
		if (request.to && !to) throw new StatsInputError('Bitiş tarihi anlaşılamadı: `' + quoteInput(request.to) + '`. Örnek: 2024-03-15, 15.03.2024, 2024-03 veya 2024.');
		firstDay = from ? from.first : earliest;
		lastDay = Math.min(to ? to.last : today, today);
		if (firstDay > today) throw new StatsInputError('Başlangıç tarihi gelecekte olamaz.');
		if (firstDay > lastDay) throw new StatsInputError('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
		label = formatDay(firstDay) + ' – ' + formatDay(lastDay);
	}
	else {
		const preset = request.preset ?? '30d';
		label = presetNames[preset];
		const starts: Record<RangePreset, number> = {
			'today': today,
			'7d': today - 6,
			'30d': today - 29,
			'90d': today - 89,
			'365d': today - 364,
			'this-week': bucketStart(today, 'week'),
			'this-month': bucketStart(today, 'month'),
			'this-year': bucketStart(today, 'year'),
			'all': earliest,
		};
		firstDay = starts[preset] ?? starts['30d'];
		isAllTime = preset === 'all';
	}
	return {
		firstDay, lastDay, label, isAllTime, custom: Boolean(request.from || request.to),
		startMs: civilDayStartMs(firstDay, zone),
		endMs: Math.min(civilDayStartMs(lastDay + 1, zone), nowMs + 1),
	};
};
