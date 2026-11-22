import {
	ApplicationCommandOptionType, ChannelType, ChatInputCommandInteraction,
	Client,
} from 'discord.js';
import { Command } from '../constants';
import { prismaClient } from '../entry';
import { checkAndSetupWorldAndServer } from '../utils';
import { getServerSettings } from '../queries/get-server-settings';
import { getChannelSettings } from '../queries/get-channel-settings';
import { registerServerSettings, registerChannelSettings } from '../queries/register-settings';
import { defaultServerSettings, defaultChannelSettings, ServerSettings, ChannelSettings } from '../settings/configure';
import { getReactionChannelIds } from '../settings/reaction-channels';
import { showReactionChannelPicker } from './reaction-channels-ui';

const serverEmbedOptions = [
	{ name: 'Önizlemelere tepki ekleme', value: 0 },
	{ name: 'Her önizlemeye tepki ekle', value: 1 },
	{ name: 'Yalnızca oynatılabilir videolara', value: 2 },
	{ name: 'Yalnızca resim veya video önizlemelerine', value: 3 },
];
const channelEmbedOptions = [
	{ name: 'Sunucu ayarını kullan', value: 0 },
	{ name: 'Bu kanalda önizlemelere tepki ekleme', value: 1 },
	{ name: 'Her önizlemeye tepki ekle', value: 2 },
	{ name: 'Yalnızca oynatılabilir videolara', value: 3 },
	{ name: 'Yalnızca resim veya video önizlemelerine', value: 4 },
];
const ruleName = (options: { name: string; value: number }[], value: number | undefined) =>
	options.find(option => option.value === (value ?? 0))?.name ?? String(value);

export const reactionSettings: Command = {
	name: 'reaction',
	description: 'Beğeni emojilerini, tepki kurallarını ve emoji eklenecek kanalları yönet.',
	options: [
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'server',
			description: 'Sunucunun beğeni emojilerini ve genel tepki kurallarını ayarla.',
			options: [
				{ type: ApplicationCommandOptionType.String, name: 'like-reaction', description: 'Beğeni emojisi, örneğin 👍.' },
				{ type: ApplicationCommandOptionType.String, name: 'dislike-reaction', description: 'Beğenmeme emojisi, örneğin 👎.' },
				{ type: ApplicationCommandOptionType.Boolean, name: 'react-to-bots', description: 'Diğer botların mesajlarına ve WHTBA link yanıtlarına da emoji eklensin mi?' },
				{
					type: ApplicationCommandOptionType.Integer, name: 'allow-embed-reactions',
					description: 'Link önizlemelerine hangi durumda emoji eklensin?',
					choices: serverEmbedOptions,
				},
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'channel',
			description: 'Bir kanal için önizleme tepki kuralını ayarla.',
			options: [
				{
					type: ApplicationCommandOptionType.Channel, name: 'target',
					description: 'Hedef kanal; boşsa komutu kullandığın kanal.',
					channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
				},
				{
					type: ApplicationCommandOptionType.Integer, name: 'allow-embed-reactions',
					description: 'Bu kanalda link önizlemelerine hangi durumda emoji eklensin?',
					choices: channelEmbedOptions,
				},
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'channels',
			description: 'Emoji eklenecek kanalları seçim menüsüyle belirle.',
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'show',
			description: 'Emoji ve tepki ayarlarını göster.',
		},
	],
	run: async (_client: Client, interaction) => {
		const command = interaction as ChatInputCommandInteraction;
		if (!command.guildId) {
			await command.editReply('Bu komut yalnızca sunucuda kullanılabilir.');
			return;
		}
		// Replaces the initial setupserver step for fresh servers, without
		// resetting an existing guild's stored settings.
		await checkAndSetupWorldAndServer(command.guildId);
		const operation = command.options.getSubcommand();
		if (operation === 'channels') {
			await showReactionChannelPicker(command);
			return;
		}
		const record = await getServerSettings(command.guildId, prismaClient);
		const settings: ServerSettings = {
			...defaultServerSettings,
			...(record?.settings as ServerSettings | undefined || {}),
		};
		if (operation === 'server') {
			const like = command.options.getString('like-reaction');
			const dislike = command.options.getString('dislike-reaction');
			const bots = command.options.getBoolean('react-to-bots');
			const embeds = command.options.getInteger('allow-embed-reactions');
			if ((like !== null && !like.trim()) || (dislike !== null && !dislike.trim())) {
				await command.editReply('Emoji alanları boş olamaz.');
				return;
			}
			const changed = like !== null || dislike !== null || bots !== null || embeds !== null;
			if (like !== null) settings.likeReaction = like.trim();
			if (dislike !== null) settings.dislikeReaction = dislike.trim();
			if (bots !== null) settings.reactToBots = bots;
			if (embeds !== null) settings.allowEmbedReactions = embeds;
			if (changed) {
				await registerServerSettings(settings, {
					serverId: command.guildId,
					lastKnownName: command.guild?.name ?? record?.lastKnownName ?? '?',
				}, prismaClient);
			}
			await command.editReply((changed ? 'Ayarlar kaydedildi.\n\n' : '') +
				'**Sunucu emoji ayarları**\n' +
				'Beğeni: ' + settings.likeReaction + '\n' +
				'Beğenmeme: ' + settings.dislikeReaction + '\n' +
				'Bot mesajlarına tepki: ' + (settings.reactToBots ? 'Açık' : 'Kapalı') + '\n' +
				'Önizleme tepki kuralı: ' + ruleName(serverEmbedOptions, settings.allowEmbedReactions));
			return;
		}
		if (operation === 'channel') {
			const target = command.options.getChannel('target');
			const channelId = target?.id ?? command.channelId;
			const channelRecord = await getChannelSettings(channelId, prismaClient);
			const channelSettings: ChannelSettings = {
				...defaultChannelSettings,
				...(channelRecord?.settings as ChannelSettings | undefined || {}),
			};
			const value = command.options.getInteger('allow-embed-reactions');
			if (value !== null) {
				channelSettings.allowEmbedReactions = value;
				await registerChannelSettings(channelSettings, {
					channelId,
					serverId: command.guildId,
					lastKnownName: target?.name ?? channelRecord?.lastKnownName ?? '?',
				}, prismaClient);
			}
			await command.editReply((value === null ? '' : 'Kanal ayarı kaydedildi.\n\n') +
				'**<#' + channelId + '> tepki kuralı**\n' +
				'Önizleme tepki kuralı: ' + ruleName(channelEmbedOptions, channelSettings.allowEmbedReactions));
			return;
		}
		const ids = getReactionChannelIds(settings);
		await command.editReply('**Emoji ayarları**\n' +
			'Beğeni: ' + settings.likeReaction + ' | Beğenmeme: ' + settings.dislikeReaction + '\n' +
			'Bot mesajlarına tepki: ' + (settings.reactToBots ? 'Açık' : 'Kapalı') + '\n' +
			'Önizleme tepki kuralı: ' + ruleName(serverEmbedOptions, settings.allowEmbedReactions) + '\n' +
			'Emoji kanalları: ' + (ids === undefined ? 'Tüm kanallar (varsayılan)' :
				ids.length === 0 ? 'Hiçbiri' : ids.slice(0, 25).map(id => '<#' + id + '>').join(', ') +
					(ids.length > 25 ? ' (+' + (ids.length - 25) + ')' : '')) +
			'\nKanal seçimini değiştirmek için /reaction channels kullan.');
	},
};
