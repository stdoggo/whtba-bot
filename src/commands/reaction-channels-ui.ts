import {
	ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle,
	ChannelSelectMenuBuilder, ChannelSelectMenuInteraction, ChannelType,
	CommandInteraction, PermissionsBitField,
} from 'discord.js';
import { prismaClient } from '../entry';
import { getServerSettings } from '../queries/get-server-settings';
import { registerServerSettings } from '../queries/register-settings';
import { defaultServerSettings, ServerSettings } from '../settings/configure';
import { changeReactionChannels, getReactionChannelIds } from '../settings/reaction-channels';

const ADD_ID = 'whtba:reaction-channels:add';
const REMOVE_ID = 'whtba:reaction-channels:remove';
const CLEAR_ID = 'whtba:reaction-channels:clear';

const controls = () => [
	new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
		new ChannelSelectMenuBuilder()
			.setCustomId(ADD_ID)
			.setPlaceholder('Tepki eklenecek kanalları seç (en fazla 25)')
			.setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
			.setMinValues(1).setMaxValues(25),
	),
	new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
		new ChannelSelectMenuBuilder()
			.setCustomId(REMOVE_ID)
			.setPlaceholder('Seçimden çıkarılacak kanalları seç')
			.setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
			.setMinValues(1).setMaxValues(25),
	),
	new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(CLEAR_ID)
			.setLabel('Bütün kanal seçimlerini temizle')
			.setStyle(ButtonStyle.Danger),
	),
];

const selectionSummary = (ids: string[] | undefined, notice = ''): string => {
	let status: string;
	if (ids === undefined) {
		status = 'Henüz kanal filtresi tanımlanmadı. Bot eskisi gibi tüm kanallarda uygun mesajlara tepki ekler.';
	}
	else if (ids.length === 0) {
		status = 'Hiçbir kanal seçili değil. Bot otomatik emoji eklemeyecek.';
	}
	else {
		status = 'Seçili kanal sayısı: **' + ids.length + '**\n' +
			ids.slice(0, 40).map(id => '<#' + id + '>').join(', ');
		if (ids.length > 40) status += '\n(+' + (ids.length - 40) + ' kanal daha)';
	}
	return (notice ? notice + '\n\n' : '') +
		'**Emoji gönderilecek kanallar**\n' + status +
		'\n\nİlk menüden kanalları ekle, ikinci menüden çıkar. 25 kanaldan fazlası için eklemeyi tekrarla.';
};

export const showReactionChannelPicker = async (interaction: CommandInteraction): Promise<void> => {
	if (!interaction.guildId) {
		await interaction.editReply({ content: 'Bu komut sunucuda kullanılabilir.' });
		return;
	}
	const record = await getServerSettings(interaction.guildId, prismaClient);
	const settings = record?.settings as ServerSettings | null | undefined;
	await interaction.editReply({
		content: selectionSummary(getReactionChannelIds(settings)),
		components: controls(),
	});
};

export const isSelectChannelsComponent = (customId: string): boolean =>
	customId === ADD_ID || customId === REMOVE_ID || customId === CLEAR_ID;

export const processSelectChannelsComponent = async (interaction: ChannelSelectMenuInteraction | ButtonInteraction) => {
	if (!isSelectChannelsComponent(interaction.customId)) return;
	if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
		await interaction.reply({ content: 'Bu işlem için Sunucuyu Yönet yetkisi gerekli.', ephemeral: true });
		return;
	}
	await interaction.deferUpdate();
	try {
		const serverId = interaction.guildId;
		const record = await getServerSettings(serverId, prismaClient);
		if (!record) {
			await interaction.editReply({ content: 'Önce /reaction-settings server komutunu çalıştır.', components: [] });
			return;
		}
		const settings = { ...defaultServerSettings, ...(record.settings as ServerSettings || {}) };
		const action = interaction.customId === CLEAR_ID ? 'clear' :
			interaction.customId === REMOVE_ID ? 'remove' : 'add';
		const selected = interaction.isChannelSelectMenu() ? interaction.values : [];
		const updated = changeReactionChannels(getReactionChannelIds(settings), selected, action);
		await registerServerSettings(
			{ ...settings, reactionChannelIds: updated },
			{ serverId, lastKnownName: interaction.guild?.name ?? record.lastKnownName ?? '?' },
			prismaClient,
		);
		const notice = action === 'add' ? 'Kanallar eklendi.' :
			action === 'remove' ? 'Seçilen kanallar çıkarıldı.' : 'Kanal seçimi temizlendi.';
		await interaction.editReply({ content: selectionSummary(updated, notice), components: controls() });
	}
	catch (error) {
		console.error('select-channels:', error);
		await interaction.followUp({ content: 'Kanal ayarları kaydedilemedi. Lütfen tekrar dene.', ephemeral: true });
	}
};
