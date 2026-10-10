import { ApplicationCommandOptionType, Client, CommandInteraction } from 'discord.js';
import { Command } from '../constants';
import { prismaClient } from '../entry';
import { getServerSettings } from '../queries/get-server-settings';
import { registerServerSettings } from '../queries/register-settings';
import { defaultServerSettings, ServerSettings } from '../settings/configure';
import { mediaHelperSettings, MediaHelperSettings } from '../media/settings';

const choices = [
	{ name: 'Show current settings', value: 'show' },
	{ name: 'Automatic link previews', value: 'enabled' },
	{ name: 'Allow channel', value: 'channel-add' },
	{ name: 'Disallow channel', value: 'channel-remove' },
	{ name: 'Allow all channels', value: 'channel-all' },
];

const summary = (settings: MediaHelperSettings): string =>
	'**Link önizleme ayarları**\n' +
	'Otomatik embed: ' + (settings.enabled ? 'Açık' : 'Kapalı') + '\n' +
	'Kanallar: ' + (settings.allowedChannelIds === undefined ?
		'Tüm kanallar' : settings.allowedChannelIds.length ?
			settings.allowedChannelIds.map(id => '<#' + id + '>').join(', ') : 'Hiçbiri') +
	'\n\nEmoji kanalları /select-channels üzerinden ayrı yönetilir.';

export const settingsCommand: Command = {
	name: 'settings',
	description: 'Harici embed önizlemelerini ve izin verilen kanalları yönet.',
	options: [
		{ name: 'action', description: 'Değiştirilecek ayar', type: ApplicationCommandOptionType.String, choices, required: false },
		{ name: 'enabled', description: 'Link önizlemelerini aç veya kapat', type: ApplicationCommandOptionType.Boolean, required: false },
		{ name: 'channel', description: 'Eklenecek veya çıkarılacak kanal', type: ApplicationCommandOptionType.Channel, required: false },
	],
	run: async (_client: Client, interaction: CommandInteraction) => {
		if (!interaction.guildId) { await interaction.editReply({ content: 'Bu komutu sunucuda kullan.' }); return; }
		const record = await getServerSettings(interaction.guildId, prismaClient);
		if (!record) { await interaction.editReply({ content: 'Önce /setupserver komutunu çalıştır.' }); return; }
		const serverSettings = { ...defaultServerSettings, ...(record.settings as ServerSettings || {}) };
		const settings = mediaHelperSettings(serverSettings);
		const action = interaction.options.get('action')?.value as string || 'show';
		const value = interaction.options.get('enabled')?.value;
		const channel = interaction.options.get('channel')?.channel;
		let changed = false;
		if (action === 'enabled') {
			if (typeof value !== 'boolean') { await interaction.editReply({ content: 'enabled için true veya false belirt.' }); return; }
			settings.enabled = value; changed = true;
		} else if (action === 'channel-all') {
			delete settings.allowedChannelIds; changed = true;
		} else if (action === 'channel-add' || action === 'channel-remove') {
			if (!channel || ![0,5].includes(channel.type)) {
				await interaction.editReply({ content: 'Bir metin veya duyuru kanalı seç.' }); return;
			}
			if (action === 'channel-add') {
				settings.allowedChannelIds = [...new Set([...(settings.allowedChannelIds ?? []), channel.id])];
			} else if (settings.allowedChannelIds === undefined) {
				await interaction.editReply({ content: 'Önce channel-add ile bir kanal listesi oluştur.' }); return;
			} else {
				settings.allowedChannelIds = settings.allowedChannelIds.filter(id => id !== channel.id);
			}
			changed = true;
		} else if (action !== 'show') {
			await interaction.editReply({ content: 'Geçersiz işlem.' }); return;
		}
		if (changed) {
			await registerServerSettings({ ...serverSettings, mediaHelper: settings }, {
				serverId: interaction.guildId,
				lastKnownName: interaction.guild?.name ?? record.lastKnownName ?? '?',
			}, prismaClient);
		}
		await interaction.editReply({ content: (changed ? 'Ayarlar kaydedildi.\n\n' : '') + summary(settings) });
	},
};
