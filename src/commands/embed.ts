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
import { MediaHelperSettings, mediaHelperSettings, messageLinksEnabled } from '../media/settings';

// Message link previews also need the main preview switch.
const messageLinksStatus = (preferences: MediaHelperSettings) => !messageLinksEnabled(preferences) ? 'Kapalı' :
	preferences.enabled ? 'Açık' : 'Açık (ama otomatik önizleme kapalı olduğu için çalışmıyor)';

const actions = [
	{ name: 'Ayarları göster', value: 'show' },
	{ name: 'Önizlemeyi aç / kapat', value: 'enabled' },
	{ name: 'Mesaj linki önizlemesini aç / kapat', value: 'message-links' },
	{ name: 'Kanala izin ver', value: 'channel-add' },
	{ name: 'Kanalın iznini kaldır', value: 'channel-remove' },
	{ name: 'Bütün kanallara izin ver', value: 'channel-all' },
];

export const embedSettings: Command = {
	name: 'embed',
	description: 'Sosyal medya ve Discord mesaj linki önizlemelerini, kanalların medya kurallarını yönet.',
	options: [
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'preview',
			description: 'Link dönüştürmeyi, mesaj linki önizlemesini ve hangi kanallarda çalışacağını yönet.',
			options: [
				{
					type: ApplicationCommandOptionType.String, name: 'action',
					description: 'Yapılacak işlem; boşsa ayarlar gösterilir.', choices: actions,
				},
				{
					type: ApplicationCommandOptionType.Boolean, name: 'enabled',
					description: 'Seçilen işlem açık mı? (Önizlemeyi aç / kapat ya da Mesaj linki önizlemesi)',
				},
				{
					type: ApplicationCommandOptionType.Channel, name: 'channel',
					description: 'İzin verilecek ya da izni kaldırılacak kanal.',
					channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
				},
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'moderation',
			description: 'Bir kanalda medya içermeyen mesajların silinip silinmeyeceğini ayarla.',
			options: [
				{
					type: ApplicationCommandOptionType.Channel, name: 'channel',
					description: 'Hedef kanal; boşsa komutu kullandığın kanal.',
					channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
				},
				{
					type: ApplicationCommandOptionType.Integer, name: 'forbid-text',
					description: 'Medya içermeyen mesajlar ne olsun?',
					choices: [
						{ name: 'Yazıya ve medyaya izin ver', value: 0 },
						{ name: 'Yalnızca medya (yazı mesajlarını sil)', value: 1 },
					],
				},
			],
		},
		{
			type: ApplicationCommandOptionType.Subcommand, name: 'show',
			description: 'Link önizleme ve kanal medya ayarlarını göster.',
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
			} else if (action === 'message-links') {
				if (enabled === null) {
					await command.editReply('Mesaj linki önizlemesini açmak veya kapatmak için enabled:true/false belirt.');
					return;
				}
				preferences.messageLinks = enabled;
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
				'**Link önizleme ayarları**\n' +
				'Otomatik dönüştürme: ' + (preferences.enabled ? 'Açık' : 'Kapalı') + '\n' +
				'Mesaj linki önizlemesi: ' + messageLinksStatus(preferences) + '\n' +
				'Kanallar: ' + (preferences.allowedChannelIds === undefined ? 'Tüm kanallar' :
					preferences.allowedChannelIds.length === 0 ? 'Hiçbiri' :
						preferences.allowedChannelIds.slice(0, 25).map(id => '<#' + id + '>').join(', ')) +
				'\nEmoji tepkileri /reaction komutuyla yönetilir.');
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
		await command.editReply('**Link önizleme ve medya ayarları**\n' +
			'Otomatik link dönüştürme: ' + (preferences.enabled ? 'Açık' : 'Kapalı') + '\n' +
			'Mesaj linki önizlemesi: ' + messageLinksStatus(preferences) + '\n' +
			'Önizleme kanalları: ' + (preferences.allowedChannelIds === undefined ? 'Tüm kanallar' :
				preferences.allowedChannelIds.length === 0 ? 'Hiçbiri' :
					preferences.allowedChannelIds.slice(0, 25).map(id => '<#' + id + '>').join(', ')) + '\n' +
			'<#' + channelId + '> medyasız mesajlar: ' +
			(channelSettings.isTextForbidden ? 'Sil' : 'İzin ver'));
	},
};
