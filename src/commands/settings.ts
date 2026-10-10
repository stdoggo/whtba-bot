import { ApplicationCommandOptionType, Client, CommandInteraction } from 'discord.js';
import { Command } from '../constants';
import { prismaClient } from '../entry';
import { getServerSettings } from '../queries/get-server-settings';
import { registerServerSettings } from '../queries/register-settings';
import { defaultServerSettings, ServerSettings } from '../settings/configure';
import { mediaHelperSettings, MediaHelperSettings } from '../media/settings';

const choices = [
	{ name: 'Show current settings', value: 'show' },
	{ name: 'Automatic previews', value: 'enabled' },
	{ name: 'Quick-action buttons', value: 'quickActions' },
	{ name: 'Ephemeral conversion replies', value: 'ephemeralReplies' },
	{ name: 'Native video reuploads', value: 'autoUpload' },
	{ name: 'Soundboard uploads', value: 'soundboard' },
	{ name: 'Allow channel', value: 'channel-add' },
	{ name: 'Disallow channel', value: 'channel-remove' },
	{ name: 'Enable previews in all channels', value: 'channel-all' },
];

const summary = (settings: MediaHelperSettings) =>
	'**Media-Helper ayarları**\n' +
	'Automatic previews: ' + settings.enabled + '\n' +
	'Quick actions: ' + settings.quickActions + '\n' +
	'Ephemeral conversion replies: ' + settings.ephemeralReplies + '\n' +
	'Native uploads (yt-dlp/FFmpeg): ' + settings.autoUpload + '\n' +
	'Soundboard: ' + settings.soundboard + '\n' +
	'Allowed channels: ' + (settings.allowedChannelIds === undefined ?
		'Tüm kanallar' : settings.allowedChannelIds.length ?
			settings.allowedChannelIds.map(id => '<#' + id + '>').join(', ') : 'Hiçbiri') +
	'\n\n/select-channels yalnızca emoji reaksiyonlarını yönetir.';

export const settingsCommand: Command = {
	name: 'settings',
	description: 'Media-Helper özelliklerini ve izin verilen kanalları yönet.',
	options: [
		{
			name: 'action', description: 'Değiştirilecek özellik',
			type: ApplicationCommandOptionType.String, choices, required: false,
		},
		{
			name: 'enabled', description: 'Özelliği aç veya kapat',
			type: ApplicationCommandOptionType.Boolean, required: false,
		},
		{
			name: 'channel', description: 'Eklenecek veya çıkarılacak kanal',
			type: ApplicationCommandOptionType.Channel, required: false,
		},
	],
	run: async (client: Client, interaction: CommandInteraction) => {
		if (!interaction.guildId) {
			await interaction.editReply({ content: 'Bu komutu bir sunucuda kullan.' }); return;
		}
		const record = await getServerSettings(interaction.guildId, prismaClient);
		if (!record) {
			await interaction.editReply({ content: 'Önce /setupserver çalıştır.' }); return;
		}
		const serverSettings = { ...defaultServerSettings, ...(record.settings as ServerSettings || {}) };
		const settings = mediaHelperSettings(serverSettings);
		const action = interaction.options.get('action')?.value as string || 'show';
		const value = interaction.options.get('enabled')?.value;
		const channel = interaction.options.get('channel')?.channel;
		let changed = false;
		if (['enabled','quickActions','ephemeralReplies','autoUpload','soundboard'].includes(action)) {
			if (typeof value !== 'boolean') {
				await interaction.editReply({ content: 'Bu ayar için enabled:true/false belirt.' });
				return;
			}
			(settings as unknown as Record<string, unknown>)[action] = value;
			changed = true;
		} else if (action === 'channel-all') {
			delete settings.allowedChannelIds;
			changed = true;
		} else if (action === 'channel-add' || action === 'channel-remove') {
			if (!channel) {
				await interaction.editReply({ content: 'Bir metin kanalı seç.' }); return;
			}
			const ids = settings.allowedChannelIds ?? [];
			if (action === 'channel-add') settings.allowedChannelIds = [...new Set([...ids, channel.id])];
			else settings.allowedChannelIds = ids.filter(id => id !== channel.id);
			changed = true;
		} else if (action !== 'show') {
			await interaction.editReply({ content: 'Geçersiz işlem.' }); return;
		}
		if (changed) {
			await registerServerSettings(
				{ ...serverSettings, mediaHelper: settings },
				{ serverId: interaction.guildId, lastKnownName: interaction.guild?.name ?? record.lastKnownName ?? '?' },
				prismaClient,
			);
		}
		await interaction.editReply({ content: (changed ? 'Ayarlar kaydedildi.\n\n' : '') + summary(settings) });
	},
};
