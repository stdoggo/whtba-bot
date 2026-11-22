import {
	ChannelType, Collection, DiscordAPIError, Guild, GuildMember, Message, PartialMessage,
	PermissionFlagsBits,
} from 'discord.js';
import {
	LoggedMessage, deleteMessages, getState, insertMessages, saveAuthorNames, setState,
} from './store';
import { msToSnowflake } from './time';

// Message statistics run in three layers:
// 1. Live tracking: every new message is queued and written in small batches.
// 2. History scan (/stats sync): reads every readable channel and thread
//    backwards from today to the very first message. Resumable after restarts.
// 3. Gap catch-up: after every new gateway session, messages sent while the
//    bot was offline are fetched from each channel's last known "watermark".
// Every write is INSERT OR IGNORE by message ID, so the layers can overlap safely.

const MESSAGE_CHANNEL_TYPES = new Set<number>([
	ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice,
	ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread,
]);
const GUILD_MEDIA_CHANNEL = 16;
const THREAD_PARENT_TYPES = new Set<number>([
	ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, GUILD_MEDIA_CHANNEL,
]);
const FATAL_DISCORD_CODES = new Set([10003, 50001, 50013]); // unknown channel, missing access/permissions
const FLUSH_DELAY_MS = 2000;
const FLUSH_SIZE = 100;
const WATERMARK_FLUSH_MS = 30000;
const BACKFILL_CONCURRENCY = 3;
const PAGE = 100;
const FLUSH_RETRY_MS = 5000;

type AnyChannel = any;

export type BackfillStatus = 'idle' | 'running' | 'stopped' | 'partial' | 'done';

export interface BackfillProgress {
	status: BackfillStatus;
	running: boolean;
	stopRequested: boolean;
	totalChannels: number;
	doneChannels: number;
	skippedChannels: number;
	failedChannels: number;
	fetchedThisRun: number;
	current: string[];
	startedAt: number | null;
	finishedAt: number | null;
	catchUpRunning: boolean;
}

const maxId = (ids: Iterable<string>): bigint | null => {
	let result: bigint | null = null;
	for (const id of ids) {
		const value = BigInt(id);
		if (result === null || value > result) result = value;
	}
	return result;
};
const minId = (ids: Iterable<string>): bigint | null => {
	let result: bigint | null = null;
	for (const id of ids) {
		const value = BigInt(id);
		if (result === null || value < result) result = value;
	}
	return result;
};

const isThreadChannel = (channel: AnyChannel) =>
	channel?.type === ChannelType.PublicThread || channel?.type === ChannelType.PrivateThread ||
	channel?.type === ChannelType.AnnouncementThread;

// Converts a Discord message to a statistics row. System messages (joins, pins,
// boosts, thread notices...) are not counted.
export const toLoggedMessage = (message: Message | PartialMessage, parentId?: string | null): LoggedMessage | null => {
	if (!message.guildId || !message.author || message.system) return null;
	const channel: AnyChannel = message.channel;
	const parent = parentId ?? (isThreadChannel(channel) ? channel.parentId : null);
	return {
		id: message.id,
		channelId: parent ?? message.channelId,
		authorId: message.author.id,
		isBot: Boolean(message.author.bot || message.webhookId),
		syncId: message.channelId,
	};
};

export const authorDisplayName = (message: Message | PartialMessage, member?: GuildMember | null): string | null => {
	const author = message.author;
	if (!author) return null;
	return member?.displayName ?? author.globalName ?? author.username ?? null;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isFatal = (error: unknown) => error instanceof DiscordAPIError && FATAL_DISCORD_CODES.has(Number(error.code));

const withRetry = async <T>(task: () => Promise<T>): Promise<T> => {
	const delays = [2000, 5000, 15000];
	for (let attempt = 0; ; attempt++) {
		try {
			return await task();
		}
		catch (error) {
			if (isFatal(error) || attempt >= delays.length) throw error;
			await sleep(delays[attempt]);
		}
	}
};

export class MessageStatsService {
	private queue: LoggedMessage[] = [];
	private pendingNames = new Map<string, string>();
	private savedNames = new Map<string, string>();
	private flushTimer: NodeJS.Timeout | null = null;
	private flushChain: Promise<void> = Promise.resolve();

	// Gap tracking
	private session = 0;
	private trackingLoaded = false;
	private watermarked = new Set<string>();
	private live = new Set<string>();
	private pendingWatermarks = new Map<string, bigint>();
	private watermarkTimer: NodeJS.Timeout | null = null;
	private catchUpRunning = false;

	// History scan
	private backfillRunning = false;
	private stopRequested = false;
	private progress = { total: 0, done: 0, skipped: 0, failed: 0, fetched: 0, startedAt: 0 };
	private current = new Map<string, string>();

	private readonly prisma: any;

	constructor(prisma: any) {
		this.prisma = prisma;
	}

	// -------------------------------------------------------------------------
	// Live tracking
	// -------------------------------------------------------------------------
	record(message: Message | PartialMessage) {
		const row = toLoggedMessage(message);
		if (!row) return;
		this.queue.push(row);
		const name = authorDisplayName(message, message.member);
		if (name && this.savedNames.get(row.authorId) !== name) this.pendingNames.set(row.authorId, name);
		if (this.queue.length >= FLUSH_SIZE) {void this.flush();}
		else if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
			this.flushTimer.unref?.();
		}
	}

	async forget(ids: string[]) {
		if (!ids.length) return;
		const removed = new Set(ids);
		this.queue = this.queue.filter(row => !removed.has(row.id));
		await this.flushChain;
		// A failed flush may have put the rows back in the queue meanwhile.
		this.queue = this.queue.filter(row => !removed.has(row.id));
		await deleteMessages(this.prisma, ids);
	}

	flush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.flushChain = this.flushChain.then(() => this.flushNow()).catch(error => {
			console.error('Message stats flush:', error);
			if (this.queue.length && !this.flushTimer) {
				this.flushTimer = setTimeout(() => void this.flush(), FLUSH_RETRY_MS);
				this.flushTimer.unref?.();
			}
		});
		return this.flushChain;
	}

	private async flushNow() {
		const rows = this.queue.splice(0);
		const names = [...this.pendingNames].map(([id, name]) => ({ id, name }));
		this.pendingNames.clear();
		if (rows.length) {
			try {
				await insertMessages(this.prisma, rows);
			}
			catch (error) {
				// Keep the rows for the next attempt unless the queue is growing without bound.
				if (this.queue.length < 10000) this.queue.unshift(...rows);
				for (const { id, name } of names) if (!this.pendingNames.has(id)) this.pendingNames.set(id, name);
				throw error;
			}
		}
		if (names.length) {
			await saveAuthorNames(this.prisma, names, true);
			for (const { id, name } of names) this.savedNames.set(id, name);
		}
		if (rows.length) await this.advanceWatermarks(rows);
	}

	private async advanceWatermarks(rows: LoggedMessage[]) {
		if (!this.trackingLoaded) return;
		const bySync = new Map<string, { parentId: string | null; ids: string[] }>();
		for (const row of rows) {
			const entry = bySync.get(row.syncId) ?? { parentId: row.channelId === row.syncId ? null : row.channelId, ids: [] };
			entry.ids.push(row.id);
			bySync.set(row.syncId, entry);
		}
		for (const [syncId, { parentId, ids }] of bySync) {
			const newest = maxId(ids)!;
			if (this.live.has(syncId)) {
				const pending = this.pendingWatermarks.get(syncId);
				if (pending === undefined || newest > pending) this.pendingWatermarks.set(syncId, newest);
			}
			else if (!this.watermarked.has(syncId)) {
				// First message seen in this channel: start following it from here on.
				await this.prisma.messageSyncChannel.upsert({
					where: { id: BigInt(syncId) },
					create: { id: BigInt(syncId), parentId: parentId ? BigInt(parentId) : null, watermark: newest },
					update: {},
				});
				await this.prisma.messageSyncChannel.updateMany({ where: { id: BigInt(syncId), watermark: null }, data: { watermark: newest } });
				this.watermarked.add(syncId);
				this.live.add(syncId);
			}
		}
		if (this.pendingWatermarks.size && !this.watermarkTimer) {
			this.watermarkTimer = setTimeout(() => void this.flushWatermarks(), WATERMARK_FLUSH_MS);
			this.watermarkTimer.unref?.();
		}
	}

	private async raiseWatermark(syncId: string, value: bigint) {
		await this.prisma.messageSyncChannel.updateMany({
			where: { id: BigInt(syncId), OR: [{ watermark: null }, { watermark: { lt: value } }] },
			data: { watermark: value },
		});
	}

	private async flushWatermarks() {
		if (this.watermarkTimer) {
			clearTimeout(this.watermarkTimer);
			this.watermarkTimer = null;
		}
		const pending = [...this.pendingWatermarks];
		this.pendingWatermarks.clear();
		try {
			for (const [syncId, value] of pending) await this.raiseWatermark(syncId, value);
		}
		catch (error) {
			console.error('Message stats watermark:', error);
		}
	}

	async shutdown() {
		this.stopRequested = true;
		await this.flush();
		await this.flushWatermarks();
	}

	// -------------------------------------------------------------------------
	// Sessions and gap catch-up
	// -------------------------------------------------------------------------
	// Call on the first ready event and whenever the gateway opens a new session
	// (events from the disconnected period are not replayed in that case).
	async onSessionReady(guild: Guild) {
		const session = ++this.session;
		this.trackingLoaded = false;
		this.live.clear();
		await this.flush();
		const rows: { id: bigint; watermark: bigint }[] = await this.prisma.messageSyncChannel.findMany({
			where: { watermark: { not: null } }, select: { id: true, watermark: true },
		});
		if (session !== this.session) return;
		this.watermarked = new Set(rows.map(row => String(row.id)));
		this.trackingLoaded = true;

		const status = await getState(this.prisma, 'backfill.status');
		if (status === 'running' && !this.backfillRunning) {
			console.log('Message stats: resuming history scan.');
			void this.startBackfill(guild);
		}
		void this.catchUp(guild, session, new Map(rows.map(row => [String(row.id), row.watermark])), status === 'done')
			.catch(error => console.error('Message stats catch-up:', error));
	}

	private async catchUp(guild: Guild, session: number, watermarks: Map<string, bigint>, historyDone: boolean) {
		this.catchUpRunning = true;
		try {
			const me = guild.members.me ?? await guild.members.fetchMe();
			const channels = [...guild.channels.cache.values()].filter((channel: AnyChannel) =>
				MESSAGE_CHANNEL_TYPES.has(channel.type) &&
				channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]));
			let fetched = 0;
			for (const channel of channels as AnyChannel[]) {
				if (session !== this.session) return;
				const watermark = watermarks.get(channel.id);
				const last = channel.lastMessageId ? BigInt(channel.lastMessageId) : null;
				try {
					if (watermark !== undefined) {
						if (last !== null && last > watermark) fetched += await this.fetchForward(channel, watermark, session);
						else if (session === this.session) this.live.add(channel.id);
					}
					else if (historyDone && last !== null && !this.backfillRunning) {
						// A channel created while the bot was offline after the history scan finished,
						// or one that was empty or unreadable during the scan: read it from the start.
						await this.ensureSyncRow(channel);
						await this.prisma.messageSyncChannel.updateMany({
							where: { id: BigInt(channel.id), watermark: null },
							data: { backfillDone: false, backfillCursor: null, lastError: null },
						});
						fetched += (await this.backfillChannel(channel, session, () => session !== this.session)).count;
					}
				}
				catch (error) {
					console.error('Message stats catch-up failed for channel', channel.id, error);
				}
			}
			if (fetched) console.log('Message stats: caught up ' + fetched + ' messages sent while offline.');
		}
		finally {
			if (session === this.session) this.catchUpRunning = false;
		}
	}

	private async fetchForward(channel: AnyChannel, after: bigint, session: number): Promise<number> {
		let cursor = after;
		let total = 0;
		for (;;) {
			if (session !== this.session) return total;
			const page: Collection<string, Message> = await withRetry(() =>
				channel.messages.fetch({ after: cursor.toString(), limit: PAGE, cache: false }));
			await this.storePage(page, isThreadChannel(channel) ? channel.parentId : null);
			total += page.size;
			const newest = maxId(page.keys());
			if (newest !== null && newest > cursor) {
				cursor = newest;
				await this.raiseWatermark(channel.id, cursor);
			}
			if (page.size < PAGE) break;
		}
		if (session === this.session) this.live.add(channel.id);
		return total;
	}

	// Fetched pages carry no member data (no server nicknames), so they only fill in
	// names that are not known yet and never overwrite one saved from a live message.
	private async storePage(page: Collection<string, Message>, parentId: string | null) {
		const rows: LoggedMessage[] = [];
		const names = new Map<string, string>();
		for (const message of page.values()) {
			const row = toLoggedMessage(message, parentId);
			if (!row) continue;
			rows.push(row);
			const name = authorDisplayName(message);
			if (name && !names.has(row.authorId) && !this.savedNames.has(row.authorId)) names.set(row.authorId, name);
		}
		await insertMessages(this.prisma, rows);
		await saveAuthorNames(this.prisma, [...names].map(([id, name]) => ({ id, name })), false);
	}

	// -------------------------------------------------------------------------
	// History scan
	// -------------------------------------------------------------------------
	async startBackfill(guild: Guild): Promise<'started' | 'already-running'> {
		if (this.backfillRunning) return 'already-running';
		this.backfillRunning = true;
		this.stopRequested = false;
		this.progress = { total: 0, done: 0, skipped: 0, failed: 0, fetched: 0, startedAt: Date.now() };
		this.current.clear();
		await setState(this.prisma, 'backfill.status', 'running');
		await setState(this.prisma, 'backfill.startedAt', String(this.progress.startedAt));
		void this.runBackfill(guild)
			.catch(async error => {
				console.error('Message stats history scan:', error);
				await setState(this.prisma, 'backfill.status', 'partial').catch(() => undefined);
			})
			.finally(() => {
				this.backfillRunning = false;
				this.current.clear();
			});
		return 'started';
	}

	async stopBackfill(): Promise<boolean> {
		if (!this.backfillRunning) return false;
		this.stopRequested = true;
		await setState(this.prisma, 'backfill.status', 'stopped');
		return true;
	}

	async getProgress(): Promise<BackfillProgress> {
		const status = (await getState(this.prisma, 'backfill.status') ?? 'idle') as BackfillStatus;
		const finished = await getState(this.prisma, 'backfill.finishedAt');
		const started = await getState(this.prisma, 'backfill.startedAt');
		return {
			status,
			running: this.backfillRunning,
			stopRequested: this.stopRequested,
			totalChannels: this.progress.total,
			doneChannels: this.progress.done,
			skippedChannels: this.progress.skipped,
			failedChannels: this.progress.failed,
			fetchedThisRun: this.progress.fetched,
			current: [...this.current.values()],
			startedAt: started ? Number(started) : null,
			finishedAt: finished ? Number(finished) : null,
			catchUpRunning: this.catchUpRunning,
		};
	}

	async isHistoryComplete(): Promise<boolean> {
		return (await getState(this.prisma, 'backfill.status')) === 'done';
	}

	private async runBackfill(guild: Guild) {
		const session = this.session;
		const targets = await this.discoverTargets(guild);
		for (const channel of targets) await this.ensureSyncRow(channel);
		// Channels that failed with an access error were discovered as readable now,
		// so scan them again.
		const targetIds = targets.map(channel => BigInt(channel.id));
		await this.prisma.messageSyncChannel.updateMany({
			where: { id: { in: targetIds }, backfillDone: true, lastError: { not: null } },
			data: { backfillDone: false, lastError: null },
		});
		const done = new Set((await this.prisma.messageSyncChannel.findMany({
			where: { backfillDone: true }, select: { id: true },
		})).map((row: { id: bigint }) => String(row.id)));
		const pending = targets.filter(channel => !done.has(channel.id));
		// Unreadable channels found during discovery count towards the total as skipped.
		this.progress.total = targets.length + this.progress.skipped;
		this.progress.done = targets.length - pending.length;

		const worker = async () => {
			while (pending.length && !this.stopRequested) {
				const channel = pending.shift();
				const result = await this.backfillChannel(channel, session, () => this.stopRequested).catch(error => {
					console.error('Message stats history scan failed for channel', channel.id, error);
					return null;
				});
				if (!result) this.progress.failed++;
				else if (result.skipped) this.progress.skipped++;
				else if (!this.stopRequested) this.progress.done++;
			}
		};
		await Promise.all(Array.from({ length: BACKFILL_CONCURRENCY }, worker));
		await this.flush();
		if (this.stopRequested) return;

		const remaining = await this.prisma.messageSyncChannel.count({ where: { backfillDone: false, id: { in: targetIds } } });
		await setState(this.prisma, 'backfill.status', remaining ? 'partial' : 'done');
		await setState(this.prisma, 'backfill.finishedAt', String(Date.now()));
		console.log('Message stats: history scan finished (' + this.progress.fetched + ' messages read, ' + remaining + ' channels incomplete).');
	}

	private async ensureSyncRow(channel: AnyChannel) {
		const parentId = isThreadChannel(channel) && channel.parentId ? BigInt(channel.parentId) : null;
		const name = typeof channel.name === 'string' ? channel.name.slice(0, 100) : null;
		await this.prisma.messageSyncChannel.upsert({
			where: { id: BigInt(channel.id) },
			create: { id: BigInt(channel.id), parentId, name },
			update: { parentId, name },
		});
	}

	// Every readable message channel, voice text chat, active thread and archived thread.
	private async discoverTargets(guild: Guild): Promise<AnyChannel[]> {
		const me = guild.members.me ?? await guild.members.fetchMe();
		const readable = (channel: AnyChannel) =>
			channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
		const targets = new Map<string, AnyChannel>();
		const channels = await guild.channels.fetch();
		for (const channel of channels.values() as Iterable<AnyChannel>) {
			if (!channel) continue;
			if (MESSAGE_CHANNEL_TYPES.has(channel.type)) {
				if (readable(channel)) targets.set(channel.id, channel);
				else this.progress.skipped++;
			}
			if (!THREAD_PARENT_TYPES.has(channel.type) || !readable(channel)) continue;
			const types: ('public' | 'private')[] = ['public'];
			if (channel.type !== ChannelType.GuildForum && channel.type !== GUILD_MEDIA_CHANNEL &&
				channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageThreads)) types.push('private');
			for (const type of types) {
				try {
					let before: Date | undefined;
					for (;;) {
						const result = await withRetry<any>(() => channel.threads.fetchArchived({ type, fetchAll: true, before, limit: 100 }, false));
						for (const thread of result.threads.values()) targets.set(thread.id, thread);
						if (!result.hasMore || !result.threads.size) break;
						const oldest = Math.min(...[...result.threads.values()].map((t: AnyChannel) => t.archiveTimestamp ?? Date.now()));
						before = new Date(oldest);
					}
				}
				catch (error) {
					console.warn('Message stats: archived ' + type + ' threads unavailable in', channel.id, (error as Error).message);
				}
			}
		}
		try {
			const active = await guild.channels.fetchActiveThreads();
			for (const thread of active.threads.values()) targets.set(thread.id, thread);
		}
		catch (error) {
			console.warn('Message stats: active threads unavailable', (error as Error).message);
		}
		// Top-level channels first, then threads.
		return [...targets.values()].sort((a, b) => Number(isThreadChannel(a)) - Number(isThreadChannel(b)));
	}

	// Reads one channel backwards from its saved cursor to its first message.
	private async backfillChannel(channel: AnyChannel, session: number, shouldStop: () => boolean): Promise<{ count: number; skipped: boolean }> {
		const id = BigInt(channel.id);
		const row = await this.prisma.messageSyncChannel.findUnique({ where: { id } });
		if (row?.backfillDone) return { count: 0, skipped: Boolean(row.lastError) };
		const parentId = isThreadChannel(channel) ? channel.parentId : null;
		let before: string | undefined = row?.backfillCursor ? String(row.backfillCursor) : undefined;
		let firstPage = true;
		let total = 0;
		this.current.set(channel.id, (parentId ? '🧵 ' : '#') + (channel.name ?? channel.id));
		try {
			while (!shouldStop()) {
				let page: Collection<string, Message>;
				const fetchedAt = Date.now();
				try {
					page = await withRetry(() => channel.messages.fetch({ limit: PAGE, before, cache: false }));
				}
				catch (error) {
					if (!isFatal(error)) throw error;
					await this.prisma.messageSyncChannel.update({ where: { id }, data: { backfillDone: true, lastError: (error as Error).message.slice(0, 200) } });
					return { count: total, skipped: true };
				}
				await this.storePage(page, parentId);
				total += page.size;
				this.progress.fetched += page.size;
				const oldest = minId(page.keys());
				const finished = page.size < PAGE;
				await this.prisma.messageSyncChannel.update({
					where: { id },
					data: {
						backfillCursor: oldest ?? row?.backfillCursor ?? null,
						backfillDone: finished,
						fetchedCount: { increment: page.size },
						lastError: null,
					},
				});
				if (firstPage && !before) {
					// The newest page doubles as the starting point for gap catch-up. An empty
					// channel starts from the moment it was read: everything before is known.
					const newest = maxId(page.keys()) ?? msToSnowflake(fetchedAt) - 1n;
					if (newest >= 0n) {
						const updated = await this.prisma.messageSyncChannel.updateMany({ where: { id, watermark: null }, data: { watermark: newest } });
						if (updated.count && this.trackingLoaded && session === this.session) {
							this.watermarked.add(channel.id);
							this.live.add(channel.id);
						}
					}
				}
				firstPage = false;
				if (finished || oldest === null) break;
				before = oldest.toString();
			}
		}
		finally {
			this.current.delete(channel.id);
		}
		return { count: total, skipped: false };
	}
}
