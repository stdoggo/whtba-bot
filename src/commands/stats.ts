import {
	ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle,
	ApplicationCommandOptionData, ApplicationCommandOptionType, ApplicationCommandSubCommandData, ApplicationCommandSubGroupData, AttachmentBuilder, ChannelType,
	ChatInputCommandInteraction, Client, EmbedBuilder, Guild, PermissionsBitField,
} from 'discord.js';
import { Command } from '../constants';
import { messageStats, prismaClient } from '../entry';
import { formatNumber, renderRanking, renderTimeSeries } from '../stats/chart';
import {
	StatsFilter, authorRank, countAuthors, countByHour, countChannels, countMessages, earliestMessageId,
	getAuthorNames, topAuthors, topChannels,
} from '../stats/store';
import {
	Interval, RangePreset, ResolvedRange, StatsInputError, autoInterval, bucketLabel, bucketStarts,
	civilDate, civilDayOf, civilDayStartMs, daysToBuckets, formatBucketRange, formatDay, formatWeekday, hoursToDays, intervalNames,
	intervalUnits, msToSnowflake, presetNames, rankDays, resolveRange, snowflakeToMs, statsTimeZone,
} from '../stats/time';

const EMBED_COLOR = 0x5865f2;
const MAX_BUCKETS = 1100;
const TOP_DAYS = 20;

// ---------------------------------------------------------------------------
// Option definitions
// ---------------------------------------------------------------------------
type Option = Exclude<ApplicationCommandOptionData, ApplicationCommandSubGroupData | ApplicationCommandSubCommandData>;
const intervalOption: Option = {
	type: ApplicationCommandOptionType.String, name: 'interval',
	description: 'Grafikteki her çubuğun süresi.',
	choices: (Object.keys(intervalNames) as Interval[]).map(value => ({ name: intervalNames[value], value })),
};
const rangeOptions: Option[] = [
	{
		type: ApplicationCommandOptionType.String, name: 'range',
		description: 'Hazır tarih aralığı. from/to girilirse onlar geçerli olur.',
		choices: (Object.keys(presetNames) as RangePreset[]).map(value => ({ name: presetNames[value], value })),
	},
	{
		type: ApplicationCommandOptionType.String, name: 'from',
		description: 'Başlangıç: 2024-03-15, 15.03.2024, 2024-03 veya 2024.', maxLength: 10,
	},
	{
		type: ApplicationCommandOptionType.String, name: 'to',
		description: 'Bitiş (dahil): 2024-03-31, 31.03.2024, 2024-03 veya 2024. Boşsa bugün.', maxLength: 10,
	},
];
const channelOption: Option = {
	type: ApplicationCommandOptionType.Channel, name: 'channel',
	description: 'Yalnızca bu kanal (alt başlıkları dahil).',
	channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice,
		ChannelType.GuildStageVoice, ChannelType.GuildForum],
};
const botsOption: Option = {
	type: ApplicationCommandOptionType.Boolean, name: 'include-bots', description: 'Bot mesajlarını da say.',
};
const privateOption: Option = {
	type: ApplicationCommandOptionType.Boolean, name: 'private', description: 'Sonucu yalnızca sen gör (gizli yanıt).',
};
const pageOption: Option = {
	type: ApplicationCommandOptionType.Integer, name: 'page', description: 'Açılacak sayfa (varsayılan 1).', minValue: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const percent = (part: number, total: number) =>
	total ? '%' + new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(part / total * 100) : '%0';

const plural = (value: number, unit: string) => formatNumber(value) + ' ' + unit;

const filterFor = (range: ResolvedRange, extra: Partial<StatsFilter>): StatsFilter => ({
	startId: msToSnowflake(range.startMs),
	endId: msToSnowflake(range.endMs),
	...extra,
});

const readRange = async (command: ChatInputCommandInteraction, guild: Guild, base: Partial<StatsFilter>, defaultPreset: RangePreset) => {
	const from = command.options.getString('from');
	const to = command.options.getString('to');
	const preset = (command.options.getString('range') as RangePreset | null) ?? (from || to ? null : defaultPreset);
	let earliestMs = guild.createdTimestamp;
	if (preset === 'all' || (!from && to)) {
		const first = await earliestMessageId(prismaClient, base);
		if (first !== null) earliestMs = snowflakeToMs(first);
	}
	return resolveRange({ preset, from, to, nowMs: Date.now(), earliestMs, zone: statsTimeZone() });
};

const defaultPresetFor = (interval: Interval | null): RangePreset => {
	if (interval === 'week') return '365d';
	if (interval === 'month' || interval === 'year') return 'all';
	return '30d';
};

export const BOTS_NOTE = '🤖 Bot mesajları dahil';
// Charts use plain text: the chart font has no emoji.
const BOTS_CHART_NOTE = 'Bot mesajları dahil';

// Bot messages inside the filter: everything minus human messages.
const botMessageCount = async (filter: StatsFilter) => {
	const [all, humans] = await Promise.all([
		countMessages(prismaClient, { ...filter, includeBots: true }),
		countMessages(prismaClient, { ...filter, includeBots: false }),
	]);
	return all - humans;
};

// Shown under the first line of the description when bot messages are counted,
// e.g. "🤖 Bot mesajları dahil (**1.234** mesaj)".
const botsLine = async (filter: StatsFilter) => filter.includeBots
	? '\n' + BOTS_NOTE + ' (**' + formatNumber(await botMessageCount(filter)) + '** mesaj)'
	: '';
const botsChartNotes = (includeBots: boolean) => includeBots ? [BOTS_CHART_NOTE] : [];

const footerText = async () => {
	const zone = statsTimeZone();
	if (await messageStats.isHistoryComplete()) return 'Saat dilimi: ' + zone;
	return '⚠️ Geçmiş mesaj taraması tamamlanmadı; eski mesajlar eksik olabilir (/stats sync). Saat dilimi: ' + zone;
};

const resolveNames = async (guild: Guild, ids: string[]): Promise<Map<string, string>> => {
	const names = new Map<string, string>();
	const stored = await getAuthorNames(prismaClient, ids);
	const missing: string[] = [];
	for (const id of ids) {
		const cached = guild.members.cache.get(id)?.displayName;
		if (cached) names.set(id, cached);
		else if (stored.has(id)) names.set(id, stored.get(id)!);
		else missing.push(id);
	}
	await Promise.allSettled(missing.slice(0, 25).map(async id => {
		const member = await guild.members.fetch(id);
		names.set(id, member.displayName);
	}));
	for (const id of ids) if (!names.has(id)) names.set(id, 'Bilinmeyen (' + id.slice(-4) + ')');
	return names;
};

const channelName = async (guild: Guild, id: string): Promise<string> => {
	const cached = guild.channels.cache.get(id);
	if (cached) return '#' + cached.name;
	const row = await prismaClient.messageSyncChannel.findUnique({ where: { id: BigInt(id) } });
	return '#' + (row?.name ?? 'silinmiş-kanal');
};

interface Series {
	interval: Interval;
	starts: number[];
	values: number[];
	labels: string[];
	total: number;
	peakIndex: number;
}

const buildSeries = async (range: ResolvedRange, filter: StatsFilter, requested: Interval | null): Promise<Series> => {
	const zone = statsTimeZone();
	const interval = requested ?? autoInterval(range.lastDay - range.firstDay + 1);
	const starts = bucketStarts(range.firstDay, range.lastDay, interval, MAX_BUCKETS);
	if (starts.length > MAX_BUCKETS) {
		throw new StatsInputError('Bu aralık ' + intervalNames[interval].toLowerCase() + ' gösterim için çok uzun. ' +
			'Daha kısa bir aralık veya haftalık/aylık/yıllık `interval` seç.');
	}
	const buckets = daysToBuckets(hoursToDays(await countByHour(prismaClient, filter), zone), interval);
	const values = starts.map(start => buckets.get(start) ?? 0);
	const withYear = civilDate(range.firstDay).year !== civilDate(range.lastDay).year;
	const labels = starts.map(start => bucketLabel(start, interval, withYear));
	let peakIndex = -1;
	values.forEach((value, index) => { if (value > 0 && (peakIndex < 0 || value > values[peakIndex])) peakIndex = index; });
	return { interval, starts, values, labels, total: values.reduce((a, b) => a + b, 0), peakIndex };
};

const chartFile = (buffer: Buffer) => new AttachmentBuilder(buffer, { name: 'stats.png' });

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------
const serverStats = async (command: ChatInputCommandInteraction, guild: Guild) => {
	const channel = command.options.getChannel('channel');
	const base = { channelId: channel?.id, includeBots: command.options.getBoolean('include-bots') ?? false };
	const requested = command.options.getString('interval') as Interval | null;
	const range = await readRange(command, guild, base, defaultPresetFor(requested));
	const filter = filterFor(range, base);
	const series = await buildSeries(range, filter, requested);
	const authors = await countAuthors(prismaClient, filter);
	const scope = channel ? '#' + channel.name : guild.name;
	const image = renderTimeSeries({
		title: scope + ' · ' + intervalNames[series.interval] + ' mesajlar',
		subtitle: range.label + ' · toplam ' + plural(series.total, 'mesaj'),
		labels: series.labels, values: series.values, highlightIndex: series.peakIndex,
		notes: botsChartNotes(base.includeBots),
	});
	const unit = intervalUnits[series.interval];
	const embed = new EmbedBuilder()
		.setColor(EMBED_COLOR)
		.setTitle('📊 Mesaj istatistikleri — ' + scope)
		.setDescription('**' + range.label + '** · ' + intervalNames[series.interval] + ' görünüm' + await botsLine(filter))
		.addFields(
			{ name: 'Toplam mesaj', value: formatNumber(series.total), inline: true },
			{ name: 'Ortalama / ' + unit, value: formatNumber(Math.round(series.total / Math.max(series.starts.length, 1))), inline: true },
			{ name: 'Mesaj atan üye', value: formatNumber(authors), inline: true },
			{
				name: 'En yoğun ' + unit,
				value: series.peakIndex < 0 ? '—' : formatBucketRange(series.starts[series.peakIndex], series.interval) +
					' — **' + formatNumber(series.values[series.peakIndex]) + '**',
			},
		)
		.setImage('attachment://stats.png')
		.setFooter({ text: await footerText() });
	await command.editReply({ embeds: [embed], files: [chartFile(image)] });
};

const userStats = async (command: ChatInputCommandInteraction, guild: Guild) => {
	const user = command.options.getUser('user') ?? command.user;
	const channel = command.options.getChannel('channel');
	const includeBots = user.bot || (command.options.getBoolean('include-bots') ?? false);
	const base = { channelId: channel?.id, authorId: user.id, includeBots };
	const requested = command.options.getString('interval') as Interval | null;
	const range = await readRange(command, guild, base, defaultPresetFor(requested));
	const filter = filterFor(range, base);
	const series = await buildSeries(range, filter, requested);
	const everyone = { ...filter, authorId: null };
	const [serverTotal, rank, authors, channels] = await Promise.all([
		countMessages(prismaClient, everyone),
		authorRank(prismaClient, everyone, user.id),
		countAuthors(prismaClient, everyone),
		channel ? Promise.resolve([]) : topChannels(prismaClient, filter, 3),
	]);
	const name = (await resolveNames(guild, [user.id])).get(user.id)!;
	const image = renderTimeSeries({
		title: name + ' · ' + intervalNames[series.interval] + ' mesajlar',
		subtitle: range.label + (channel ? ' · #' + channel.name : '') + ' · toplam ' + plural(series.total, 'mesaj'),
		labels: series.labels, values: series.values, highlightIndex: series.peakIndex,
		notes: botsChartNotes(base.includeBots),
	});
	const unit = intervalUnits[series.interval];
	const embed = new EmbedBuilder()
		.setColor(EMBED_COLOR)
		.setTitle('👤 ' + name + ' — mesaj istatistikleri')
		.setThumbnail(user.displayAvatarURL({ size: 128 }))
		.setDescription('**' + range.label + '**' + (channel ? ' · <#' + channel.id + '>' : '') + ' · ' + intervalNames[series.interval] + ' görünüm' + await botsLine(filter))
		.addFields(
			{ name: 'Toplam mesaj', value: formatNumber(series.total), inline: true },
			{ name: 'Sıralama', value: rank.rank ? '#' + rank.rank + ' / ' + formatNumber(authors) : '—', inline: true },
			{ name: 'Sunucu payı', value: percent(series.total, serverTotal), inline: true },
			{ name: 'Ortalama / ' + unit, value: formatNumber(Math.round(series.total / Math.max(series.starts.length, 1))), inline: true },
			{
				name: 'En yoğun ' + unit,
				value: series.peakIndex < 0 ? '—' : formatBucketRange(series.starts[series.peakIndex], series.interval) +
					' — **' + formatNumber(series.values[series.peakIndex]) + '**',
				inline: true,
			},
		)
		.setImage('attachment://stats.png')
		.setFooter({ text: await footerText() });
	if (channels.length) {
		embed.addFields({
			name: 'En aktif kanallar',
			value: channels.map(item => '<#' + item.id + '> — ' + formatNumber(item.count) + ' (' + percent(item.count, series.total) + ')').join('\n'),
		});
	}
	await command.editReply({ embeds: [embed], files: [chartFile(image)] });
};

// ---------------------------------------------------------------------------
// Paginated rankings: busiest days, members and channels share one layout.
// The page state lives in the button IDs, so the buttons keep working after a
// restart and need no stored session. Only the member who ran the command can
// turn the pages.
// ---------------------------------------------------------------------------
const PAGE_PREFIX = 'whtba:pg:';
const LEGACY_TOP_DAYS_PREFIX = 'whtba:topdays:';
const PER_PAGE = 20;
const MEDALS = ['🥇', '🥈', '🥉'];

export type ListKind = 'days' | 'users' | 'channels';
const KIND_CODES: Record<ListKind, string> = { days: 'd', users: 'u', channels: 'c' };

export interface ListState {
	kind: ListKind;
	page: number; // 0-based
	// Date range: a preset key, or "d<firstDay>-<lastDay>" for custom dates. Not used for days.
	range: string;
	channelId: string | null;
	userId: string | null; // days only
	includeBots: boolean;
	ownerId: string;
}

// Two filter slots keep the ID under Discord's 100 character limit:
// days → channel, user; users → range, channel; channels → range.
export const listCustomId = (state: ListState, page: number, tag: string) => {
	const slots = state.kind === 'days'
		? [state.channelId ?? '0', state.userId ?? '0']
		: [state.range, state.kind === 'users' ? state.channelId ?? '0' : '0'];
	return PAGE_PREFIX + [KIND_CODES[state.kind], page, ...slots, state.includeBots ? 1 : 0, state.ownerId, tag].join(':');
};

export const parseListId = (customId: string): ListState | null => {
	const id = (value: string | undefined) => value && value !== '0' && /^\d+$/.test(value) ? value : null;
	if (customId.startsWith(LEGACY_TOP_DAYS_PREFIX)) {
		const [page, channelId, userId, bots, ownerId] = customId.slice(LEGACY_TOP_DAYS_PREFIX.length).split(':');
		if (!/^\d+$/.test(page ?? '') || !id(ownerId)) return null;
		return { kind: 'days', page: Number(page), range: 'all', channelId: id(channelId), userId: id(userId), includeBots: bots === '1', ownerId: ownerId! };
	}
	if (!customId.startsWith(PAGE_PREFIX)) return null;
	const [code, page, slotA, slotB, bots, ownerId] = customId.slice(PAGE_PREFIX.length).split(':');
	const kind = (Object.keys(KIND_CODES) as ListKind[]).find(key => KIND_CODES[key] === code);
	if (!kind || !/^\d+$/.test(page ?? '') || !id(ownerId) || slotA === undefined || slotB === undefined) return null;
	const base = { kind, page: Number(page), includeBots: bots === '1', ownerId: ownerId! };
	if (kind === 'days') return { ...base, range: 'all', channelId: id(slotA), userId: id(slotB) };
	return { ...base, range: slotA, channelId: kind === 'users' ? id(slotB) : null, userId: null };
};

export const isStatsComponent = (customId: string) =>
	customId.startsWith(PAGE_PREFIX) || customId.startsWith(LEGACY_TOP_DAYS_PREFIX);

export const pageCount = (items: number, perPage = PER_PAGE) => Math.max(1, Math.ceil(items / perPage));

const pageButtons = (state: ListState, pages: number) => {
	const page = state.page;
	const button = (target: number, tag: string, label: string, disabled: boolean) => new ButtonBuilder()
		.setCustomId(listCustomId(state, target, tag)).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		button(0, 'first', '⏮', page === 0),
		button(Math.max(page - 1, 0), 'prev', '◀ Önceki', page === 0),
		button(page, 'info', 'Sayfa ' + (page + 1) + ' / ' + pages, true),
		button(Math.min(page + 1, pages - 1), 'next', 'Sonraki ▶', page >= pages - 1),
		button(pages - 1, 'last', '⏭', page >= pages - 1),
	);
};

// 🥇🥈🥉 for the first three places, then right-aligned numbers.
export const rankPrefix = (rank: number, totalItems: number) =>
	MEDALS[rank - 1] ?? '`' + String(rank).padStart(String(totalItems).length) + '.`';

interface ListPage {
	title: string;
	empty: string;
	header: string;
	filter: StatsFilter; // the list's filter, used for the bot message note
	total: number; // number of ranked items
	lines: (offset: number) => Promise<string[]>;
	chart: (notes: string[]) => Promise<Buffer>;
	chartCount: number;
	chartUnit: string;
}

const renderList = async (state: ListState, list: ListPage) => {
	const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(list.title);
	if (!list.total) {
		embed.setDescription(list.empty + await botsLine(list.filter)).setFooter({ text: await footerText() });
		return { embeds: [embed], files: [], components: [] };
	}
	const pages = pageCount(list.total);
	const current = { ...state, page: Math.min(Math.max(state.page, 0), pages - 1) };
	const lines = await list.lines(current.page * PER_PAGE);
	embed.setDescription(list.header + await botsLine(list.filter) + '\n\n' + lines.join('\n'))
		.setImage('attachment://stats.png')
		.setFooter({ text: 'Sayfa ' + (current.page + 1) + '/' + pages + ' · ' + await footerText() });
	const notes = ['Grafik ilk ' + list.chartCount + ' ' + list.chartUnit + ' gösterir', ...botsChartNotes(state.includeBots)];
	return { embeds: [embed], files: [chartFile(await list.chart(notes))], components: pages > 1 ? [pageButtons(current, pages)] : [] };
};

// Range tokens make a command's date range reproducible from a button ID.
const rangeToken = (command: ChatInputCommandInteraction, range: ResolvedRange) => {
	const from = command.options.getString('from');
	const to = command.options.getString('to');
	if (from || to) return 'd' + range.firstDay + '-' + range.lastDay;
	return command.options.getString('range') ?? 'all';
};

const rangeFromToken = async (token: string, guild: Guild, base: Partial<StatsFilter>): Promise<ResolvedRange> => {
	const zone = statsTimeZone();
	const custom = token.match(/^d(\d+)-(\d+)$/);
	if (custom) {
		const firstDay = Number(custom[1]);
		const lastDay = Number(custom[2]);
		return {
			firstDay, lastDay, isAllTime: false,
			label: formatDay(firstDay) + ' – ' + formatDay(lastDay),
			startMs: civilDayStartMs(firstDay, zone),
			endMs: Math.min(civilDayStartMs(lastDay + 1, zone), Date.now() + 1),
		};
	}
	const preset = (token in presetNames ? token : 'all') as RangePreset;
	let earliestMs = guild.createdTimestamp;
	if (preset === 'all') {
		const first = await earliestMessageId(prismaClient, base);
		if (first !== null) earliestMs = snowflakeToMs(first);
	}
	return resolveRange({ preset, nowMs: Date.now(), earliestMs, zone });
};

const buildDaysView = async (guild: Guild, state: ListState) => {
	const filter: StatsFilter = {
		startId: 0n, endId: msToSnowflake(Date.now() + 1),
		channelId: state.channelId, authorId: state.userId, includeBots: state.includeBots,
	};
	const days = hoursToDays(await countByHour(prismaClient, filter), statsTimeZone());
	const ranked = rankDays(days, Infinity);
	const channel = state.channelId ? guild.channels.cache.get(state.channelId) : null;
	const scope = [
		state.channelId ? '#' + (channel?.name ?? 'kanal') : guild.name,
		state.userId ? (await resolveNames(guild, [state.userId])).get(state.userId) : null,
	].filter(Boolean).join(' · ');
	const chartDays = ranked.slice(0, TOP_DAYS);
	return renderList(state, {
		title: '📅 En çok mesaj atılan günler — ' + scope,
		empty: 'Henüz kayıtlı mesaj yok.',
		filter,
		header: ranked.length ? 'Sunucunun başından bu yana · ' + formatDay(Math.min(...days.keys())) + ' itibarıyla ' +
			plural(ranked.length, 'aktif gün') : '',
		total: ranked.length,
		lines: async offset => ranked.slice(offset, offset + PER_PAGE).map(([day, count], index) =>
			rankPrefix(offset + index + 1, ranked.length) + ' **' + formatDay(day) + '**, ' + formatWeekday(day) +
				' — **' + formatNumber(count) + '** mesaj'),
		chart: async notes => renderRanking({
			notes,
			title: 'En yoğun ' + chartDays.length + ' gün · ' + scope,
			subtitle: 'Tüm zamanlar',
			labels: chartDays.map(([day]) => bucketLabel(day, 'day', true)),
			values: chartDays.map(([, count]) => count),
		}),
		chartCount: chartDays.length,
		chartUnit: 'günü',
	});
};

const buildUsersView = async (guild: Guild, state: ListState) => {
	const base = { channelId: state.channelId, includeBots: state.includeBots };
	const range = await rangeFromToken(state.range, guild, base);
	const filter = filterFor(range, base);
	const [total, authors, own, top] = await Promise.all([
		countMessages(prismaClient, filter),
		countAuthors(prismaClient, filter),
		authorRank(prismaClient, filter, state.ownerId),
		topAuthors(prismaClient, filter, TOP_DAYS),
	]);
	const channel = state.channelId ? guild.channels.cache.get(state.channelId) : null;
	const scope = state.channelId ? '#' + (channel?.name ?? 'kanal') : guild.name;
	return renderList(state, {
		title: '🏆 En çok mesaj atanlar — ' + scope,
		empty: '**' + range.label + '**\nBu aralıkta kayıtlı mesaj yok.',
		filter,
		header: '**' + range.label + '** · ' + plural(total, 'mesaj') + ' · ' + plural(authors, 'üye'),
		total: authors,
		lines: async offset => {
			const page = offset ? await topAuthors(prismaClient, filter, PER_PAGE, offset) : top.slice(0, PER_PAGE);
			const lines = page.map((item, index) => rankPrefix(offset + index + 1, authors) + ' <@' + item.id + '> — **' +
				formatNumber(item.count) + '** mesaj (' + percent(item.count, total) + ')');
			if (own.rank && !page.some(item => item.id === state.ownerId)) {
				lines.push('…\n**Sen:** ' + own.rank + '. sıra — <@' + state.ownerId + '> — **' + formatNumber(own.count) + '** mesaj');
			}
			return lines;
		},
		chart: async notes => {
			const names = await resolveNames(guild, top.map(item => item.id));
			return renderRanking({
				notes,
				title: 'En çok mesaj atanlar · ' + scope,
				subtitle: range.label + ' · toplam ' + plural(total, 'mesaj'),
				labels: top.map(item => names.get(item.id)!),
				values: top.map(item => item.count),
			});
		},
		chartCount: top.length,
		chartUnit: 'kişiyi',
	});
};

const buildChannelsView = async (guild: Guild, state: ListState) => {
	const base = { includeBots: state.includeBots };
	const range = await rangeFromToken(state.range, guild, base);
	const filter = filterFor(range, base);
	const [total, channels, top] = await Promise.all([
		countMessages(prismaClient, filter),
		countChannels(prismaClient, filter),
		topChannels(prismaClient, filter, TOP_DAYS),
	]);
	return renderList(state, {
		title: '💬 En aktif kanallar — ' + guild.name,
		empty: '**' + range.label + '**\nBu aralıkta kayıtlı mesaj yok.',
		filter,
		header: '**' + range.label + '** · ' + plural(total, 'mesaj') + ' · ' + plural(channels, 'kanal'),
		total: channels,
		lines: async offset => {
			const page = offset ? await topChannels(prismaClient, filter, PER_PAGE, offset) : top.slice(0, PER_PAGE);
			return page.map((item, index) => rankPrefix(offset + index + 1, channels) + ' <#' + item.id + '> — **' +
				formatNumber(item.count) + '** mesaj (' + percent(item.count, total) + ')');
		},
		chart: async notes => renderRanking({
			notes,
			title: 'En aktif kanallar · ' + guild.name,
			subtitle: range.label + ' · toplam ' + plural(total, 'mesaj'),
			labels: await Promise.all(top.map(item => channelName(guild, item.id))),
			values: top.map(item => item.count),
		}),
		chartCount: top.length,
		chartUnit: 'kanalı',
	});
};

const buildListView = (guild: Guild, state: ListState) => {
	if (state.kind === 'users') return buildUsersView(guild, state);
	if (state.kind === 'channels') return buildChannelsView(guild, state);
	return buildDaysView(guild, state);
};

const commandListState = async (command: ChatInputCommandInteraction, guild: Guild, kind: ListKind): Promise<ListState> => {
	const user = kind === 'days' ? command.options.getUser('user') : null;
	const channelId = kind === 'channels' ? null : command.options.getChannel('channel')?.id ?? null;
	const includeBots = Boolean(user?.bot) || (command.options.getBoolean('include-bots') ?? false);
	let range = 'all';
	if (kind !== 'days') {
		// Validates from/to and turns them into a token the buttons can carry.
		range = rangeToken(command, await readRange(command, guild, { channelId, includeBots }, 'all'));
	}
	return {
		kind, range, channelId, includeBots,
		page: (command.options.getInteger('page') ?? 1) - 1,
		userId: user?.id ?? null,
		ownerId: command.user.id,
	};
};

const listCommand = (kind: ListKind) => async (command: ChatInputCommandInteraction, guild: Guild) => {
	const view = await buildListView(guild, await commandListState(command, guild, kind));
	await command.editReply({ ...view, allowedMentions: { parse: [] } });
};
const leaderboard = listCommand('users');
const channelRanking = listCommand('channels');
const topDays = listCommand('days');

const listCommandNames: Record<ListKind, string> = { days: 'top-days', users: 'leaderboard', channels: 'channels' };

export const processStatsComponent = async (interaction: ButtonInteraction) => {
	const state = parseListId(interaction.customId);
	if (!state || !interaction.guild) return;
	if (interaction.user.id !== state.ownerId) {
		await interaction.reply({
			content: 'Bu sayfaları yalnızca komutu kullanan kişi çevirebilir. Kendin için `/stats ' + listCommandNames[state.kind] + '` kullan.',
			ephemeral: true,
		});
		return;
	}
	await interaction.deferUpdate();
	try {
		await messageStats.flush();
		const view = await buildListView(interaction.guild, state);
		await interaction.editReply({ ...view, attachments: [], allowedMentions: { parse: [] } });
	}
	catch (error) {
		console.error('stats page:', error);
		await interaction.followUp({ content: 'Sayfa yüklenemedi. Lütfen tekrar dene.', ephemeral: true });
	}
};

const statusNames: Record<string, string> = {
	idle: 'Başlatılmadı', running: 'Çalışıyor', stopped: 'Durduruldu', partial: 'Yarım kaldı (tekrar başlat)', done: 'Tamamlandı ✅',
};

const syncStats = async (command: ChatInputCommandInteraction, guild: Guild) => {
	if (!command.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
		await command.editReply('Geçmiş taramasını yönetmek için Sunucuyu Yönet yetkisi gerekli.');
		return;
	}
	const action = command.options.getString('action') ?? 'status';
	let notice = '';
	if (action === 'start') {
		const result = await messageStats.startBackfill(guild);
		notice = result === 'started'
			? 'Geçmiş mesaj taraması başlatıldı. Büyük sunucularda bu işlem saatler sürebilir; bot yeniden başlarsa kaldığı yerden devam eder.'
			: 'Tarama zaten çalışıyor.';
	}
	else if (action === 'stop') {
		notice = await messageStats.stopBackfill()
			? 'Tarama durduruluyor. Daha sonra `start` ile kaldığı yerden devam edebilirsin.'
			: 'Çalışan bir tarama yok.';
	}
	const progress = await messageStats.getProgress();
	const total = await prismaClient.messageLog.count();
	const first = await earliestMessageId(prismaClient, { includeBots: true });
	const lines = [
		'**Durum:** ' + (statusNames[progress.status] ?? progress.status) + (progress.stopRequested && progress.running ? ' (durduruluyor…)' : ''),
	];
	if (progress.running || progress.totalChannels) {
		lines.push('**Kanallar ve başlıklar:** ' + formatNumber(progress.doneChannels) + ' / ' + formatNumber(progress.totalChannels) +
			(progress.skippedChannels ? ' · erişilemeyen: ' + formatNumber(progress.skippedChannels) : '') +
			(progress.failedChannels ? ' · hata: ' + formatNumber(progress.failedChannels) : ''));
		lines.push('**Bu çalıştırmada okunan:** ' + plural(progress.fetchedThisRun, 'mesaj'));
	}
	if (progress.current.length) lines.push('**Şu an taranıyor:** ' + progress.current.slice(0, 5).join(', '));
	if (progress.catchUpRunning) lines.push('Bot kapalıyken atılan mesajlar tamamlanıyor…');
	if (progress.finishedAt && progress.status === 'done') lines.push('**Bitiş:** <t:' + Math.floor(progress.finishedAt / 1000) + ':R>');
	lines.push('**Veritabanındaki mesaj:** ' + formatNumber(total) + (first !== null ? ' · ilk mesaj: ' + formatDay(civilDayOf(snowflakeToMs(first), statsTimeZone())) : ''));
	if (progress.status === 'idle') lines.push('\nSunucunun başından bu yana tüm mesajları saymak için `/stats sync action:Başlat` kullan.');
	await command.editReply((notice ? notice + '\n\n' : '') + '**📥 Geçmiş mesaj taraması**\n' + lines.join('\n'));
};

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------
export const stats: Command = {
	name: 'stats',
	description: 'Sunucu mesaj istatistikleri, grafikler ve sıralamalar.',
	adminOnly: false,
	ephemeral: interaction => interaction.options.getSubcommand(false) === 'sync' ||
		(interaction.options.getBoolean('private') ?? false),
	options: [
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'server',
			description: 'Sunucunun ya da bir kanalın mesaj grafiği.',
			options: [intervalOption, ...rangeOptions, channelOption, botsOption, privateOption],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'user',
			description: 'Bir üyenin mesaj grafiği, toplamı ve sıralaması.',
			options: [
				{ type: ApplicationCommandOptionType.User, name: 'user', description: 'Üye; boşsa sen.' },
				intervalOption, ...rangeOptions, channelOption, botsOption, privateOption,
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'leaderboard',
			description: 'Kimin toplam kaç mesaj attığını sıralar, sayfa sayfa.',
			options: [...rangeOptions, channelOption, pageOption, botsOption, privateOption],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'channels',
			description: 'Kanalları mesaj sayısına göre sıralar, sayfa sayfa.',
			options: [...rangeOptions, pageOption, botsOption, privateOption],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'top-days',
			description: 'Sunucu açıldığından beri en çok mesaj atılan günler, sayfa sayfa.',
			options: [
				channelOption,
				pageOption,
				{ type: ApplicationCommandOptionType.User, name: 'user', description: 'Yalnızca bu üyenin mesajları.' },
				botsOption, privateOption,
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'sync',
			description: 'Geçmiş mesaj taramasını yönet (Sunucuyu Yönet yetkisi gerekir).',
			options: [{
				type: ApplicationCommandOptionType.String, name: 'action', description: 'Yapılacak işlem; boşsa durum gösterilir.',
				choices: [
					{ name: 'Durum', value: 'status' },
					{ name: 'Başlat / devam et', value: 'start' },
					{ name: 'Durdur', value: 'stop' },
				],
			}],
		},
	],
	run: async (_client: Client, interaction) => {
		const command = interaction as ChatInputCommandInteraction;
		const guild = command.guild;
		if (!guild) {
			await command.editReply('Bu komut yalnızca sunucuda kullanılabilir.');
			return;
		}
		await messageStats.flush();
		try {
			switch (command.options.getSubcommand()) {
				case 'server': return await serverStats(command, guild);
				case 'user': return await userStats(command, guild);
				case 'leaderboard': return await leaderboard(command, guild);
				case 'channels': return await channelRanking(command, guild);
				case 'top-days': return await topDays(command, guild);
				case 'sync': return await syncStats(command, guild);
			}
		}
		catch (error) {
			if (error instanceof StatsInputError) {
				await command.editReply({ content: error.message, embeds: [], files: [], allowedMentions: { parse: [] } });
				return;
			}
			throw error;
		}
	},
};
