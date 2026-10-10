import { CommandInteraction, Client } from 'discord.js';
import { Command, HELP_MESSAGE, NOT_REGISTERED_MESSAGE } from '../constants';
import { interactionIsInDMs, isValidEnvironment } from '../utils';
const FOLLOW_UP_TEXT = 'WHTBA bot hakkında yardım için sunucu yöneticisine başvur.';


export const help: Command = {
	name: 'help',
	description: 'Need help setting up? Run this.',
	run: async (client: Client, interaction: CommandInteraction) => {
		if (!interaction.guildId) {
			await interaction.followUp({
				ephemeral: true,
				content: 'Please run this command within a channel inside a server. ' + FOLLOW_UP_TEXT,
			});
			return;
		}

		let content = '';
		const ve = await isValidEnvironment(interaction.guildId);
		if(ve?.pointOfFailure) {
			content = NOT_REGISTERED_MESSAGE;
		}
		else {
			content = HELP_MESSAGE;
		}
		await interaction.followUp({
			ephemeral: true,
			content,
		});
	},
};
