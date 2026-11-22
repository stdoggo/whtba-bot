import { ChatInputCommandInteraction, Client } from 'discord.js';
import { Command } from '../constants';

// Gateway heartbeat latency; right after startup it is not measured yet (-1), then the
// time since the command was sent is used instead.
export const pingValue = (client: Client, interaction: Pick<ChatInputCommandInteraction, 'createdTimestamp'>, now = Date.now()) => {
	const heartbeat = Math.round(client.ws.ping);
	return heartbeat >= 0 ? heartbeat : Math.max(0, now - interaction.createdTimestamp);
};

export const pingMessage = (ms: number) => 'size oy verenlerden **' + ms + '** kişi inaktif';

export const ping: Command = {
	name: 'ping',
	description: 'Botun gecikmesini gösterir.',
	adminOnly: false,
	ephemeral: () => false,
	run: async (client: Client, interaction) => {
		const command = interaction as ChatInputCommandInteraction;
		await command.editReply({ content: pingMessage(pingValue(client, command)), allowedMentions: { parse: [] } });
	},
};
