import { Client } from 'discord.js';
import { Commands } from '../constants';
import { isValidEnvironment } from '../utils';
import { PermissionsBitField } from 'discord.js';

export const processCommand = async (client: Client, interaction: any) => {
	await interaction.deferReply({ ephemeral: interaction.commandName === 'select-channels' });
	const slashCommand = Commands.find(c => c.name === interaction.commandName);
	if (!slashCommand) {
		interaction.followUp({ content: `An error has occurred; command: ${interaction.commandName} does not exist.` + '\nYardım için sunucu yöneticisine başvur.' });
		return;
	}
	else if (!interaction?.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
		interaction.followUp({ content: 'You need admin permissions to manage this bot.' + '\nYardım için sunucu yöneticisine başvur.' });
		return;
	}

	let ve;
	switch (interaction.commandName) {
		case 'help': // Help command is always available.
			slashCommand.run(client, interaction);
			break;
		case 'setupserver': // Setup server command is available, and also checks within the command if we're inside a valid channel on the server.
			slashCommand.run(client, interaction);
			break;
		case 'select-channels':
			await slashCommand.run(client, interaction);
			break;
		default: // All other commands are only available if we're in a valid environment, which requires setupserver to run.
			ve = await isValidEnvironment(interaction.guildId);
			if (ve?.pointOfFailure) {
				interaction.followUp({ content: ve.pointOfFailure + '\nYardım için sunucu yöneticisine başvur.' });
				return;
			}
			slashCommand.run(client, interaction);
			break;
	}
};
