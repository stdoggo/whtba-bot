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
	{ name: 'Ignore embed reactions', value: 0 },
	{ name: 'React to every embed', value: 1 },
	{ name: 'React only to playable videos', value: 2 },
	{ name: 'React only to image or video previews', value: 3 },
];
const channelEmbedOptions = [
	{ name: 'Follow server rules', value: 0 },
	{ name: 'Disallow embed reactions', value: 1 },
	{ name: 'React to every embed', value: 2 },
	{ name: 'React only to playable videos', value: 3 },
	{ name: 'React only to image or video previews', value: 4 },
];

export const reactionSettings: Command = {
	name: 'reaction-settings',
	description: 'Emoji, tepki kuralları ve emoji eklenecek kanalları yönet.',
	options: [
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'server',
			description: 'Sunucu emojilerini ve bot mesajlarına tepki ayarını yönet.',
			options: [
				{ type: ApplicationCommandOptionType.String, name: 'like-reaction', description: 'Beğeni emojisi, örneğin 👍.' },
				{ type: ApplicationCommandOptionType.String, name: 'dislike-reaction', description: 'Beğenmeme emojisi, örneğin 👎.' },
				{ type: ApplicationCommandOptionType.Boolean, name: 'react-to-bots', description: 'Diğer botlara ve WHTBA embed yanıtlarına emoji ekle.' },
				{
					type: ApplicationCommandOptionType.Integer, name: 'allow-embed-reactions',
					description: 'Bağlantı önizlemelerine hangi koşullarda emoji ekleneceği.',
					choices: serverEmbedOptions,
				},
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'channel',
			description: 'Belirli bir kanal için embed tepki kurallarını düzenle.',
			options: [
				{
					type: ApplicationCommandOptionType.Channel, name: 'target',
					description: 'Hedef kanal; boşsa komutu kullandığın kanal.',
					channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
				},
				{
					type: ApplicationCommandOptionType.Integer, name: 'allow-embed-reactions',
					description: 'Bu kanalda embed mesajlarına emoji ekleme kuralı.',
					choices: channelEmbedOptions,
				},
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'channels',
			description: 'Emoji eklenecek kanalları çoklu seçim menüsüyle yönet.',
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'show',
			description: 'Sunucunun geçerli emoji ve kanal ayarlarını göster.',
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
				'Embed tepki kuralı: ' + (settings.allowEmbedReactions ?? 0));
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
				'Embed tepkileri: ' + (channelSettings.allowEmbedReactions ?? 0) +
				' (0 = sunucu ayarını kullan)');
			return;
		}
		const ids = getReactionChannelIds(settings);
		await command.editReply('**Emoji ayarları**\n' +
			'Beğeni: ' + settings.likeReaction + ' | Beğenmeme: ' + settings.dislikeReaction + '\n' +
			'Bot mesajlarına tepki: ' + (settings.reactToBots ? 'Açık' : 'Kapalı') + '\n' +
			'Embed tepki kuralı: ' + (settings.allowEmbedReactions ?? 0) + '\n' +
			'Emoji kanalları: ' + (ids === undefined ? 'Tüm kanallar (varsayılan)' :
				ids.length === 0 ? 'Hiçbiri' : ids.slice(0, 25).map(id => '<#' + id + '>').join(', ') +
					(ids.length > 25 ? ' (+' + (ids.length - 25) + ')' : '')) +
			'\nKanal seçimini değiştirmek için /reaction-settings channels kullan.');
	},
};
