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
import { mediaHelperSettings } from '../media/settings';

const actions = [
	{ name: 'Show settings', value: 'show' },
	{ name: 'Enable or disable previews', value: 'enabled' },
	{ name: 'Allow channel', value: 'channel-add' },
	{ name: 'Remove channel', value: 'channel-remove' },
	{ name: 'Allow all channels', value: 'channel-all' },
];

export const embedSettings: Command = {
	name: 'embed-settings',
	description: 'Sosyal medya link önizlemelerini ve kanal medya kurallarını yönet.',
	options: [
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'preview',
			description: 'Otomatik link dönüştürme ve embed kanal izinlerini yönet.',
			options: [
				{
					type: ApplicationCommandOptionType.String, name: 'action',
					description: 'İşlem türü.', choices: actions,
				},
				{
					type: ApplicationCommandOptionType.Boolean, name: 'enabled',
					description: 'Otomatik embed dönüştürme açık mı?',
				},
				{
					type: ApplicationCommandOptionType.Channel, name: 'channel',
					description: 'İzin verilecek veya çıkarılacak kanal.',
					channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
				},
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'moderation',
			description: 'Kanaldaki medyasız mesajların silinip silinmeyeceğini ayarla.',
			options: [
				{
					type: ApplicationCommandOptionType.Channel, name: 'channel',
					description: 'Hedef kanal; boşsa mevcut kanal.',
					channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
				},
				{
					type: ApplicationCommandOptionType.Integer, name: 'forbid-text',
					description: 'Medyasız mesajları silme.',
					choices: [
						{ name: 'Allow text and media', value: 0 },
						{ name: 'Require media', value: 1 },
					],
				},
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'show',
			description: 'Geçerli link önizleme ve kanal moderasyon ayarlarını göster.',
		},
	],
	run: async (_client: Client, interaction) => {
		const command = interaction as ChatInputCommandInteraction;
		if (!command.guildId) {
			await command.editReply('Bu komut yalnızca sunucuda kullanılabilir.');
			return;
		}
		// Both top-level commands can initialize a brand-new server safely.
		await checkAndSetupWorldAndServer(command.guildId);
		const operation = command.options.getSubcommand();
		const record = await getServerSettings(command.guildId, prismaClient);
		const serverSettings: ServerSettings = {
			...defaultServerSettings,
			...(record?.settings as ServerSettings | undefined || {}),
		};
		const preferences = mediaHelperSettings(serverSettings);
		if (operation === 'preview') {
			const action = command.options.getString('action') ?? 'show';
			const enabled = command.options.getBoolean('enabled');
			const channel = command.options.getChannel('channel');
			let changed = false;
			if (action === 'enabled') {
				if (enabled === null) {
					await command.editReply('Önizlemeyi açmak veya kapatmak için enabled:true/false belirt.');
					return;
				}
				preferences.enabled = enabled;
				changed = true;
			} else if (action === 'channel-all') {
				delete preferences.allowedChannelIds;
				changed = true;
			} else if (action === 'channel-add') {
				if (!channel) {
					await command.editReply('Bir kanal seçmelisin.');
					return;
				}
				preferences.allowedChannelIds = [...new Set([...(preferences.allowedChannelIds ?? []), channel.id])];
				changed = true;
			} else if (action === 'channel-remove') {
				if (!channel) {
					await command.editReply('Bir kanal seçmelisin.');
					return;
				}
				if (preferences.allowedChannelIds === undefined) {
					await command.editReply('Şu anda bütün kanallar izinli. Önce channel-add ile liste oluştur.');
					return;
				}
				preferences.allowedChannelIds = preferences.allowedChannelIds.filter(id => id !== channel.id);
				changed = true;
			}
			if (changed) {
				await registerServerSettings({ ...serverSettings, mediaHelper: preferences }, {
					serverId: command.guildId,
					lastKnownName: command.guild?.name ?? record?.lastKnownName ?? '?',
				}, prismaClient);
			}
			await command.editReply((changed ? 'Ayarlar kaydedildi.\n\n' : '') +
				'**Embed önizleme ayarları**\n' +
				'Otomatik dönüştürme: ' + (preferences.enabled ? 'Açık' : 'Kapalı') + '\n' +
				'Kanallar: ' + (preferences.allowedChannelIds === undefined ? 'Tüm kanallar' :
					preferences.allowedChannelIds.length === 0 ? 'Hiçbiri' :
						preferences.allowedChannelIds.slice(0, 25).map(id => '<#' + id + '>').join(', ')) +
				'\nEmoji tepkileri /reaction-settings altında yönetilir.');
			return;
		}
		const target = operation === 'moderation' ? command.options.getChannel('channel') : null;
		const channelId = target?.id ?? command.channelId;
		const existing = await getChannelSettings(channelId, prismaClient);
		const channelSettings: ChannelSettings = {
			...defaultChannelSettings,
			...(existing?.settings as ChannelSettings | undefined || {}),
		};
		if (operation === 'moderation') {
			const forbid = command.options.getInteger('forbid-text');
			if (forbid !== null) {
				channelSettings.isTextForbidden = forbid === 1;
				await registerChannelSettings(channelSettings, {
					channelId,
					serverId: command.guildId,
					lastKnownName: target?.name ?? existing?.lastKnownName ?? '?',
				}, prismaClient);
			}
			await command.editReply((forbid === null ? '' : 'Kanal kuralı kaydedildi.\n\n') +
				'**<#' + channelId + '> medya kuralı**\n' +
				'Medyasız mesajlar: ' + (channelSettings.isTextForbidden ? 'Sil' : 'İzin ver'));
			return;
		}
		await command.editReply('**Embed ayarları**\n' +
			'Otomatik link dönüştürme: ' + (preferences.enabled ? 'Açık' : 'Kapalı') + '\n' +
			'Önizleme kanalları: ' + (preferences.allowedChannelIds === undefined ? 'Tüm kanallar' :
				preferences.allowedChannelIds.length === 0 ? 'Hiçbiri' :
					preferences.allowedChannelIds.slice(0, 25).map(id => '<#' + id + '>').join(', ')) + '\n' +
			'<#' + channelId + '> medyasız mesajlar: ' +
			(channelSettings.isTextForbidden ? 'Sil' : 'İzin ver'));
	},
};
