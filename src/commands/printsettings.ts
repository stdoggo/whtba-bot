import { CommandInteraction, Client } from 'discord.js';
import { Command } from '../constants';
import { interactionIsInDMs, stringifyJSONWithBigIntSupport } from '../utils';
import { getServerSettings } from '../queries/get-server-settings';
import { prismaClient } from '../entry';

export const printsettings: Command = {
	name: 'printsettings',
	description: 'Debugging command to print current server settings.',
	run: async (client: Client, interaction: CommandInteraction) => {
		let content = '';
		if (!interaction.guildId) {
			content = 'Please run this command within a channel inside a server.';
			await interaction.followUp({
				ephemeral: true,
				content,
			});
			return;
		}
		content = stringifyJSONWithBigIntSupport((await getServerSettings(interaction.guildId, prismaClient))?.settings);
		await interaction.followUp({
			ephemeral: true,
			content,
		});
	},
};
