import {
	ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle,
	ApplicationCommandOptionData, ApplicationCommandOptionType, ApplicationCommandSubCommandData, ApplicationCommandSubGroupData, AttachmentBuilder, ChannelType,
	ChatInputCommandInteraction, Client, EmbedBuilder, Guild, PermissionsBitField,
} from 'discord.js';
import { Command } from '../constants';
import { messageStats, prismaClient } from '../entry';
import { formatNumber, renderRanking, renderTimeSeries } from '../stats/chart';
import {
	StatsFilter, authorRank, countAuthors, countByHour, countMessages, earliestMessageId,
	getAuthorNames, topAuthors, topChannels,
} from '../stats/store';
import {
	Interval, RangePreset, ResolvedRange, StatsInputError, autoInterval, bucketLabel, bucketStarts,
	civilDate, civilDayOf, daysToBuckets, formatBucketRange, formatDay, formatWeekday, hoursToDays, intervalNames,
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
		description: 'Hazır tarih aralığı. from/to verilirse onlar kullanılır.',
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
	description: 'Yalnızca bu kanal (alt başlıklar dahil).',
	channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice,
		ChannelType.GuildStageVoice, ChannelType.GuildForum],
};
const botsOption: Option = {
	type: ApplicationCommandOptionType.Boolean, name: 'include-bots', description: 'Bot mesajlarını da say.',
};
const privateOption: Option = {
	type: ApplicationCommandOptionType.Boolean, name: 'private', description: 'Sonucu yalnızca sen gör.',
};
const limitOption: Option = {
	type: ApplicationCommandOptionType.Integer, name: 'limit', description: 'Kaç kişi/kanal listelensin (varsayılan 20).',
	minValue: 3, maxValue: 25,
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
	});
	const unit = intervalUnits[series.interval];
	const embed = new EmbedBuilder()
		.setColor(EMBED_COLOR)
		.setTitle('📊 Mesaj istatistikleri — ' + scope)
		.setDescription('**' + range.label + '** · ' + intervalNames[series.interval] + ' görünüm')
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
	});
	const unit = intervalUnits[series.interval];
	const embed = new EmbedBuilder()
		.setColor(EMBED_COLOR)
		.setTitle('👤 ' + name + ' — mesaj istatistikleri')
		.setThumbnail(user.displayAvatarURL({ size: 128 }))
		.setDescription('**' + range.label + '**' + (channel ? ' · <#' + channel.id + '>' : '') + ' · ' + intervalNames[series.interval] + ' görünüm')
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

const leaderboard = async (command: ChatInputCommandInteraction, guild: Guild) => {
	const channel = command.options.getChannel('channel');
	const limit = command.options.getInteger('limit') ?? 20;
	const base = { channelId: channel?.id, includeBots: command.options.getBoolean('include-bots') ?? false };
	const range = await readRange(command, guild, base, 'all');
	const filter = filterFor(range, base);
	const [top, total, authors, own] = await Promise.all([
		topAuthors(prismaClient, filter, limit),
		countMessages(prismaClient, filter),
		countAuthors(prismaClient, filter),
		authorRank(prismaClient, filter, command.user.id),
	]);
	const scope = channel ? '#' + channel.name : guild.name;
	const embed = new EmbedBuilder()
		.setColor(EMBED_COLOR)
		.setTitle('🏆 En çok mesaj atanlar — ' + scope)
		.setFooter({ text: await footerText() });
	if (!top.length) {
		embed.setDescription('**' + range.label + '**\nBu aralıkta kayıtlı mesaj yok.');
		await command.editReply({ embeds: [embed] });
		return;
	}
	const names = await resolveNames(guild, top.map(item => item.id));
	const lines = top.map((item, index) => '`' + String(index + 1).padStart(2) + '.` <@' + item.id + '> — **' +
		formatNumber(item.count) + '** (' + percent(item.count, total) + ')');
	if (own.rank > limit) lines.push('…\n`' + own.rank + '.` <@' + command.user.id + '> — **' + formatNumber(own.count) + '** (sen)');
	embed.setDescription('**' + range.label + '** · ' + plural(total, 'mesaj') + ' · ' + plural(authors, 'üye') + '\n\n' + lines.join('\n'))
		.setImage('attachment://stats.png');
	const image = renderRanking({
		title: 'En çok mesaj atanlar · ' + scope,
		subtitle: range.label + ' · toplam ' + plural(total, 'mesaj'),
		labels: top.map(item => names.get(item.id)!),
		values: top.map(item => item.count),
	});
	await command.editReply({ embeds: [embed], files: [chartFile(image)], allowedMentions: { parse: [] } });
};

const channelRanking = async (command: ChatInputCommandInteraction, guild: Guild) => {
	const limit = command.options.getInteger('limit') ?? 20;
	const base = { includeBots: command.options.getBoolean('include-bots') ?? false };
	const range = await readRange(command, guild, base, 'all');
	const filter = filterFor(range, base);
	const [top, total] = await Promise.all([topChannels(prismaClient, filter, limit), countMessages(prismaClient, filter)]);
	const embed = new EmbedBuilder()
		.setColor(EMBED_COLOR)
		.setTitle('💬 En aktif kanallar — ' + guild.name)
		.setFooter({ text: await footerText() });
	if (!top.length) {
		embed.setDescription('**' + range.label + '**\nBu aralıkta kayıtlı mesaj yok.');
		await command.editReply({ embeds: [embed] });
		return;
	}
	const names = await Promise.all(top.map(item => channelName(guild, item.id)));
	embed.setDescription('**' + range.label + '** · ' + plural(total, 'mesaj') + '\n\n' + top.map((item, index) =>
		'`' + String(index + 1).padStart(2) + '.` <#' + item.id + '> — **' + formatNumber(item.count) + '** (' + percent(item.count, total) + ')').join('\n'))
		.setImage('attachment://stats.png');
	const image = renderRanking({
		title: 'En aktif kanallar · ' + guild.name,
		subtitle: range.label + ' · toplam ' + plural(total, 'mesaj'),
		labels: names, values: top.map(item => item.count),
	});
	await command.editReply({ embeds: [embed], files: [chartFile(image)] });
};

// ---------------------------------------------------------------------------
// Busiest days, paginated. The page state lives in the button IDs, so the
// buttons keep working after a restart and need no stored session.
// ---------------------------------------------------------------------------
const TOP_DAYS_PREFIX = 'whtba:topdays:';
const DAYS_PER_PAGE = 20;

interface TopDaysState {
	page: number; // 0-based
	channelId: string | null;
	userId: string | null;
	includeBots: boolean;
	ownerId: string;
}

const topDaysId = (state: TopDaysState, page: number, tag: string) =>
	TOP_DAYS_PREFIX + [page, state.channelId ?? '0', state.userId ?? '0', state.includeBots ? 1 : 0, state.ownerId, tag].join(':');

export const parseTopDaysId = (customId: string): TopDaysState | null => {
	if (!customId.startsWith(TOP_DAYS_PREFIX)) return null;
	const [page, channelId, userId, bots, ownerId] = customId.slice(TOP_DAYS_PREFIX.length).split(':');
	if (!/^\d+$/.test(page ?? '') || !/^\d+$/.test(ownerId ?? '')) return null;
	return {
		page: Number(page),
		channelId: channelId && channelId !== '0' ? channelId : null,
		userId: userId && userId !== '0' ? userId : null,
		includeBots: bots === '1',
		ownerId,
	};
};

export const isStatsComponent = (customId: string) => customId.startsWith(TOP_DAYS_PREFIX);

export const pageCount = (items: number, perPage = DAYS_PER_PAGE) => Math.max(1, Math.ceil(items / perPage));

const topDaysButtons = (state: TopDaysState, pages: number) => {
	const page = state.page;
	const button = (target: number, tag: string, label: string, disabled: boolean) => new ButtonBuilder()
		.setCustomId(topDaysId(state, target, tag)).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		button(0, 'first', '⏮', page === 0),
		button(Math.max(page - 1, 0), 'prev', '◀ Önceki', page === 0),
		button(page, 'info', 'Sayfa ' + (page + 1) + ' / ' + pages, true),
		button(Math.min(page + 1, pages - 1), 'next', 'Sonraki ▶', page >= pages - 1),
		button(pages - 1, 'last', '⏭', page >= pages - 1),
	);
};

const buildTopDaysView = async (guild: Guild, state: TopDaysState) => {
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
	const embed = new EmbedBuilder()
		.setColor(EMBED_COLOR)
		.setTitle('📅 En çok mesaj atılan günler — ' + scope);
	if (!ranked.length) {
		embed.setDescription('Henüz kayıtlı mesaj yok.').setFooter({ text: await footerText() });
		return { embeds: [embed], files: [], components: [] };
	}
	const pages = pageCount(ranked.length);
	state = { ...state, page: Math.min(Math.max(state.page, 0), pages - 1) };
	const offset = state.page * DAYS_PER_PAGE;
	const firstDay = Math.min(...days.keys());
	const medals = ['🥇', '🥈', '🥉'];
	const width = String(ranked.length).length;
	const lines = ranked.slice(offset, offset + DAYS_PER_PAGE).map(([day, count], index) => {
		const rank = offset + index + 1;
		return (medals[rank - 1] ?? '`' + String(rank).padStart(width) + '.`') + ' **' + formatDay(day) + '**, ' +
			formatWeekday(day) + ' — **' + formatNumber(count) + '** mesaj';
	});
	embed.setDescription('Sunucunun başından bu yana · ' + formatDay(firstDay) + ' itibarıyla ' +
		plural(ranked.length, 'aktif gün') + '\n\n' + lines.join('\n'))
		.setImage('attachment://stats.png')
		.setFooter({ text: 'Sayfa ' + (state.page + 1) + '/' + pages + ' · Grafik ilk ' + Math.min(TOP_DAYS, ranked.length) + ' günü gösterir · ' + await footerText() });
	const chartDays = ranked.slice(0, TOP_DAYS);
	const image = renderRanking({
		title: 'En yoğun ' + chartDays.length + ' gün · ' + scope,
		subtitle: 'Tüm zamanlar',
		labels: chartDays.map(([day]) => bucketLabel(day, 'day', true)),
		values: chartDays.map(([, count]) => count),
	});
	return { embeds: [embed], files: [chartFile(image)], components: pages > 1 ? [topDaysButtons(state, pages)] : [] };
};

const topDays = async (command: ChatInputCommandInteraction, guild: Guild) => {
	const user = command.options.getUser('user');
	const view = await buildTopDaysView(guild, {
		page: (command.options.getInteger('page') ?? 1) - 1,
		channelId: command.options.getChannel('channel')?.id ?? null,
		userId: user?.id ?? null,
		includeBots: Boolean(user?.bot) || (command.options.getBoolean('include-bots') ?? false),
		ownerId: command.user.id,
	});
	await command.editReply({ ...view, allowedMentions: { parse: [] } });
};

export const processStatsComponent = async (interaction: ButtonInteraction) => {
	const state = parseTopDaysId(interaction.customId);
	if (!state || !interaction.guild) return;
	if (interaction.user.id !== state.ownerId) {
		await interaction.reply({ content: 'Bu sayfaları yalnızca komutu kullanan kişi çevirebilir. Kendin için `/stats top-days` kullan.', ephemeral: true });
		return;
	}
	await interaction.deferUpdate();
	try {
		await messageStats.flush();
		const view = await buildTopDaysView(interaction.guild, state);
		await interaction.editReply({ ...view, attachments: [], allowedMentions: { parse: [] } });
	}
	catch (error) {
		console.error('stats top-days page:', error);
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
			description: 'Sunucunun (veya bir kanalın) mesaj grafiği.',
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
			description: 'Kimin toplam kaç mesaj attığı (sıralama).',
			options: [...rangeOptions, channelOption, limitOption, botsOption, privateOption],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'channels',
			description: 'Kanalların mesaj sayısı sıralaması.',
			options: [...rangeOptions, limitOption, botsOption, privateOption],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'top-days',
			description: 'Sunucu açıldığından beri en çok mesaj atılan günler (sayfa sayfa).',
			options: [
				channelOption,
				{ type: ApplicationCommandOptionType.Integer, name: 'page', description: 'Açılacak sayfa (varsayılan 1).', minValue: 1 },
				{ type: ApplicationCommandOptionType.User, name: 'user', description: 'Yalnızca bu üyenin mesajları.' },
				botsOption, privateOption,
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'sync',
			description: 'Geçmiş mesaj taramasını yönet (Sunucuyu Yönet yetkisi).',
			options: [{
				type: ApplicationCommandOptionType.String, name: 'action', description: 'İşlem; boşsa durum gösterilir.',
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
				await command.editReply({ content: error.message, embeds: [], files: [] });
				return;
			}
			throw error;
		}
	},
};
