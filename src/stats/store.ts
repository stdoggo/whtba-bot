import { Prisma } from '@prisma/client';
import { DISCORD_EPOCH, snowflakeToMs } from './time';

// Database access for message statistics. Every function receives the Prisma
// client explicitly so it can be used by the bot, scripts and tests alike.

export interface LoggedMessage {
	id: string;
	channelId: string; // top-level channel (thread parent for thread messages)
	authorId: string;
	isBot: boolean;
	syncId: string; // channel or thread the message was read from (not stored)
}

export interface StatsFilter {
	startId: bigint; // inclusive
	endId: bigint; // exclusive
	channelId?: string | null;
	authorId?: string | null;
	includeBots?: boolean;
}

const INSERT_CHUNK = 200;

export const insertMessages = async (prisma: any, rows: LoggedMessage[]): Promise<number> => {
	let inserted = 0;
	for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
		const values = rows.slice(i, i + INSERT_CHUNK).map(row =>
			Prisma.sql`(${BigInt(row.id)}, ${BigInt(row.channelId)}, ${BigInt(row.authorId)}, ${row.isBot ? 1 : 0})`);
		inserted += await prisma.$executeRaw`INSERT OR IGNORE INTO "MessageLog" ("id", "channelId", "authorId", "isBot") VALUES ${Prisma.join(values)}`;
	}
	return inserted;
};

export const deleteMessages = async (prisma: any, ids: string[]): Promise<number> => {
	if (!ids.length) return 0;
	const result = await prisma.messageLog.deleteMany({ where: { id: { in: ids.map(id => BigInt(id)) } } });
	return result.count;
};

// Snowflake span of half a year: (ms << 22).
const LONG_RANGE = BigInt(183 * 86400000) << 22n;

// grouped: the query groups by author or channel. Over long ranges SQLite would pick
// the ID index and visit every table row; the unary + stops that, so the covering
// (authorId|channelId, isBot, id) index is scanned instead, whatever the statistics say.
const where = (filter: StatsFilter, grouped = false) => {
	const id = grouped && filter.endId - filter.startId > LONG_RANGE ? Prisma.sql`+"id"` : Prisma.sql`"id"`;
	const conditions = [Prisma.sql`${id} >= ${filter.startId}`, Prisma.sql`${id} < ${filter.endId}`];
	if (filter.channelId) conditions.push(Prisma.sql`"channelId" = ${BigInt(filter.channelId)}`);
	if (filter.authorId) conditions.push(Prisma.sql`"authorId" = ${BigInt(filter.authorId)}`);
	if (!filter.includeBots) conditions.push(Prisma.sql`"isBot" = 0`);
	return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
};

const HOUR_SQL = `((("id" >> 22) + ${DISCORD_EPOCH}) / 3600000)`;
const HOUR_EXPR = Prisma.raw(HOUR_SQL);
const HOUR_MS = 3600000;

// ---------------------------------------------------------------------------
// Hourly summary table
// ---------------------------------------------------------------------------
// MessageHourStat holds server-wide message counts per (UTC hour, bot flag). SQLite
// triggers keep it in step with MessageLog: INSERT OR IGNORE only fires the insert
// trigger for rows that were really added, so duplicates are never counted twice.
let hourStatsReady = false;

const HOUR_TRIGGERS = [
	`CREATE TRIGGER IF NOT EXISTS "MessageLog_hour_insert" AFTER INSERT ON "MessageLog" BEGIN
		INSERT INTO "MessageHourStat" ("hour", "isBot", "count")
		VALUES ((((NEW."id" >> 22) + ${DISCORD_EPOCH}) / 3600000), NEW."isBot", 1)
		ON CONFLICT ("hour", "isBot") DO UPDATE SET "count" = "count" + 1;
	END`,
	`CREATE TRIGGER IF NOT EXISTS "MessageLog_hour_delete" AFTER DELETE ON "MessageLog" BEGIN
		UPDATE "MessageHourStat" SET "count" = "count" - 1
		WHERE "hour" = (((OLD."id" >> 22) + ${DISCORD_EPOCH}) / 3600000) AND "isBot" = OLD."isBot";
	END`,
];

// Run once at startup, before statistics are read. WAL lets the history scan keep
// writing while statistics are read; in the default journal mode a long read blocks
// every write and writers fail with "database is locked". The setting is stored in
// the database file.
export const prepareStatsDatabase = async (prisma: any) => {
	await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
	for (const sql of HOUR_TRIGGERS) await prisma.$executeRawUnsafe(sql);
	const [logRows, summed] = await Promise.all([
		prisma.$queryRawUnsafe('SELECT COUNT(*) AS "total" FROM "MessageLog"'),
		prisma.$queryRawUnsafe('SELECT COALESCE(SUM("count"), 0) AS "total" FROM "MessageHourStat"'),
	]);
	if (Number(logRows[0].total) !== Number(summed[0].total)) {
		// First start with this table, or rows changed while the triggers were missing.
		const started = Date.now();
		await prisma.$transaction([
			prisma.$executeRawUnsafe('DELETE FROM "MessageHourStat"'),
			prisma.$executeRawUnsafe(`INSERT INTO "MessageHourStat" ("hour", "isBot", "count")
				SELECT ${HOUR_SQL}, "isBot", COUNT(*) FROM "MessageLog" GROUP BY 1, 2`),
		]);
		console.log('Message stats: hourly summary rebuilt in ' + (Date.now() - started) + ' ms.');
	}
	hourStatsReady = true;
};

// The summary is server-wide; author and channel filters read MessageLog through
// their covering indexes instead.
const useHourStats = (filter: StatsFilter) => hourStatsReady && !filter.authorId && !filter.channelId;

const hourWhere = (filter: StatsFilter) => {
	const startHour = Math.floor(snowflakeToMs(filter.startId) / HOUR_MS);
	const endHour = Math.ceil(snowflakeToMs(filter.endId) / HOUR_MS);
	const conditions = [Prisma.sql`"hour" >= ${startHour}`, Prisma.sql`"hour" < ${endHour}`];
	if (!filter.includeBots) conditions.push(Prisma.sql`"isBot" = 0`);
	return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
};

// Message counts per UTC hour (hours since the Unix epoch). Hour buckets keep the
// result small and let the caller fold them into any local day/week/month/year.
export const countByHour = async (prisma: any, filter: StatsFilter): Promise<Map<number, number>> => {
	const rows: { hour: unknown; total: unknown }[] = useHourStats(filter)
		? await prisma.$queryRaw`SELECT "hour", SUM("count") AS "total" FROM "MessageHourStat" ${hourWhere(filter)} GROUP BY 1`
		: await prisma.$queryRaw`SELECT ${HOUR_EXPR} AS "hour", COUNT(*) AS "total" FROM "MessageLog" ${where(filter)} GROUP BY 1`;
	return new Map(rows.filter(row => Number(row.total) > 0).map(row => [Number(row.hour), Number(row.total)]));
};

export const countMessages = async (prisma: any, filter: StatsFilter): Promise<number> => {
	const rows: { total: unknown }[] = useHourStats(filter)
		? await prisma.$queryRaw`SELECT COALESCE(SUM("count"), 0) AS "total" FROM "MessageHourStat" ${hourWhere(filter)}`
		: await prisma.$queryRaw`SELECT COUNT(*) AS "total" FROM "MessageLog" ${where(filter)}`;
	return Number(rows[0]?.total ?? 0);
};

export const countAuthors = async (prisma: any, filter: StatsFilter): Promise<number> => {
	const rows: { total: unknown }[] = await prisma.$queryRaw`SELECT COUNT(DISTINCT "authorId") AS "total" FROM "MessageLog" ${where(filter, true)}`;
	return Number(rows[0]?.total ?? 0);
};

export const countChannels = async (prisma: any, filter: StatsFilter): Promise<number> => {
	const rows: { total: unknown }[] = await prisma.$queryRaw`SELECT COUNT(DISTINCT "channelId") AS "total" FROM "MessageLog" ${where(filter, true)}`;
	return Number(rows[0]?.total ?? 0);
};

export interface Ranked { id: string; count: number; }

export const topAuthors = async (prisma: any, filter: StatsFilter, limit: number, offset = 0): Promise<Ranked[]> => {
	const rows: { id: unknown; total: unknown }[] = await prisma.$queryRaw`
		SELECT "authorId" AS "id", COUNT(*) AS "total" FROM "MessageLog" ${where(filter, true)}
		GROUP BY "authorId" ORDER BY "total" DESC, "authorId" ASC LIMIT ${limit} OFFSET ${offset}`;
	return rows.map(row => ({ id: String(row.id), count: Number(row.total) }));
};

export const topChannels = async (prisma: any, filter: StatsFilter, limit: number, offset = 0): Promise<Ranked[]> => {
	const rows: { id: unknown; total: unknown }[] = await prisma.$queryRaw`
		SELECT "channelId" AS "id", COUNT(*) AS "total" FROM "MessageLog" ${where(filter, true)}
		GROUP BY "channelId" ORDER BY "total" DESC, "channelId" ASC LIMIT ${limit} OFFSET ${offset}`;
	return rows.map(row => ({ id: String(row.id), count: Number(row.total) }));
};

// 1-based position of an author among all authors in the filter (ties share a rank).
export const authorRank = async (prisma: any, filter: StatsFilter, authorId: string): Promise<{ rank: number; count: number }> => {
	const count = await countMessages(prisma, { ...filter, authorId });
	if (!count) return { rank: 0, count };
	const rows: { total: unknown }[] = await prisma.$queryRaw`
		SELECT COUNT(*) AS "total" FROM (
			SELECT "authorId" FROM "MessageLog" ${where({ ...filter, authorId: null }, true)}
			GROUP BY "authorId" HAVING COUNT(*) > ${count}
		)`;
	return { rank: Number(rows[0]?.total ?? 0) + 1, count };
};

export const earliestMessageId = async (prisma: any, filter: Omit<StatsFilter, 'startId' | 'endId'>): Promise<bigint | null> => {
	const rows: { id: unknown }[] = await prisma.$queryRaw`
		SELECT MIN("id") AS "id" FROM "MessageLog" ${where({ ...filter, startId: 0n, endId: 1n << 62n })}`;
	const id = rows[0]?.id;
	return id === null || id === undefined ? null : BigInt(id as any);
};

// ---------------------------------------------------------------------------
// Author names
// ---------------------------------------------------------------------------
// overwrite=false keeps an existing name (used for older history pages).
export const saveAuthorNames = async (prisma: any, authors: { id: string; name: string }[], overwrite = true) => {
	if (!authors.length) return;
	const now = new Date();
	for (let i = 0; i < authors.length; i += INSERT_CHUNK) {
		const values = authors.slice(i, i + INSERT_CHUNK).map(author =>
			Prisma.sql`(${BigInt(author.id)}, ${author.name.slice(0, 100)}, ${now})`);
		const conflict = overwrite
			? Prisma.sql`DO UPDATE SET "name" = excluded."name", "updatedAt" = excluded."updatedAt"`
			: Prisma.sql`DO NOTHING`;
		await prisma.$executeRaw`INSERT INTO "MessageAuthor" ("id", "name", "updatedAt") VALUES ${Prisma.join(values)}
			ON CONFLICT ("id") ${conflict}`;
	}
};

export const getAuthorNames = async (prisma: any, ids: string[]): Promise<Map<string, string>> => {
	if (!ids.length) return new Map();
	const rows = await prisma.messageAuthor.findMany({ where: { id: { in: ids.map(id => BigInt(id)) } } });
	return new Map(rows.map((row: any) => [String(row.id), row.name as string]));
};

// ---------------------------------------------------------------------------
// Synchronisation state
// ---------------------------------------------------------------------------
export const getState = async (prisma: any, key: string): Promise<string | null> =>
	(await prisma.messageStatsState.findUnique({ where: { key } }))?.value ?? null;

export const setState = async (prisma: any, key: string, value: string) =>
	prisma.messageStatsState.upsert({ where: { key }, create: { key, value }, update: { value } });
