import { Client, ChatInputCommandInteraction, PermissionsBitField } from 'discord.js';
import { Commands } from '../constants';

export const processCommand = async (client: Client, interaction: ChatInputCommandInteraction): Promise<void> => {
	const command = Commands.find(c => c.name === interaction.commandName);
	await interaction.deferReply({ ephemeral: command?.ephemeral ? command.ephemeral(interaction) : true });
	if (!command) {
		await interaction.editReply('Bu komut artık kullanılmıyor. /embed, /reaction veya /stats kullan.');
		return;
	}
	if (command.adminOnly !== false && !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
		await interaction.editReply('Bu işlem için Sunucuyu Yönet yetkisi gerekli.');
		return;
	}
	try {
		await command.run(client, interaction);
	}
	catch (error) {
		console.error('Command failed:', interaction.commandName, error);
		await interaction.editReply({ content: 'Komut işlenirken hata oluştu. Bot günlüklerini kontrol et.', embeds: [], files: [] });
	}
};
