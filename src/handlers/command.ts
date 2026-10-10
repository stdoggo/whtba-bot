import { Client, ChatInputCommandInteraction, PermissionsBitField } from 'discord.js';
import { Commands } from '../constants';

export const processCommand = async (client: Client, interaction: ChatInputCommandInteraction): Promise<void> => {
  await interaction.deferReply({ ephemeral: true });
  const command = Commands.find(c => c.name === interaction.commandName);
  if (!command) {
    await interaction.editReply('Bu komut artık kullanılmıyor. /embed-settings veya /reaction-settings kullan.');
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.editReply('Bu işlem için Sunucuyu Yönet yetkisi gerekli.');
    return;
  }
  try {
    await command.run(client, interaction);
  } catch (error) {
    console.error('Command failed:', interaction.commandName, error);
    await interaction.editReply('Komut işlenirken hata oluştu. Bot günlüklerini kontrol et.');
  }
};
