import 'dotenv/config';
import { allowedGuildId } from './private-server';
import { Client, Events, GatewayIntentBits, MessageReaction, PartialMessageReaction, PartialUser, Partials, User } from 'discord.js';
import { processMessage, getMessageParams } from './handlers/message';
import { processInitialReactions } from './utils';
import { registerMessage } from './queries/register-message';
import { findMediaLinks } from './media/sites';
import { handleAutomaticMedia } from './media/automatic';
import { processLoad } from './handlers/load';
import { processCommand } from './handlers/command';
import { processReaction } from './handlers/reactions';
import { isSelectChannelsComponent, processSelectChannelsComponent } from './commands/reaction-channels-ui';
import { PrismaClient } from '@prisma/client';
import { isStatsComponent, processStatsComponent } from './commands/stats';
import { MessageStatsService } from './stats/service';
import { prepareStatsDatabase } from './stats/store';

// Local SQLite database. Prisma reads DATABASE_URL from .env.
// No PostgreSQL server, Redis instance or external database service is used.
export const prismaClient = new PrismaClient();
// Message counts for /stats (live tracking, history scan and offline gap catch-up).
export const messageStats = new MessageStatsService(prismaClient);

// See https://discord.com/developers/docs/topics/gateway#list-of-intents
export const discordClient = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.MessageContent,

		GatewayIntentBits.GuildEmojisAndStickers,
	],
	partials: [
		Partials.Message,
		Partials.Channel,
		Partials.Reaction,
		Partials.User,
		Partials.GuildMember,
	],
});

const startMessageStats = () => {
	const guild = discordClient.guilds.cache.get(allowedGuildId);
	if (!guild) {
		console.warn('Message stats: the bot is not in the configured server.');
		return;
	}
	messageStats.onSessionReady(guild).catch(error => console.error('Message stats startup:', error));
};

let clientReady = false;
discordClient.once(Events.ClientReady, async () => {
	try {
		await processLoad(discordClient, prismaClient);
		await prepareStatsDatabase(prismaClient);
	}
	catch (e) {
		console.error(e);
		await prismaClient.$disconnect();
		process.exit(1);
	}
	clientReady = true;
	startMessageStats();
});

// A new gateway session (not a resume) means events from the offline period were
// lost; fetch the missed messages again.
discordClient.on(Events.ShardReady, () => {
	if (clientReady) startMessageStats();
});

// List of Discord Events -> https://old.discordjs.dev/#/docs/discord.js/14.11.0/typedef/Events
// Messages
discordClient.on(Events.MessageCreate, (message: any) => {
	if (message.guildId !== allowedGuildId) return;
	messageStats.record(message);
	if (discordClient.user?.id && message.author?.id === discordClient.user.id) return;
	// Do not invoke link-fixing on another bot's messages; only media reactions.
	if (message.author?.bot) {
		void processMessage(discordClient, message, prismaClient).catch(error => console.error('Bot media handler:', error));
		return;
	}
	const links = findMediaLinks(message.content ?? '');
	if (links.length) {
		void handleAutomaticMedia(message, prismaClient, links, async (reply, settings) => {
			await processInitialReactions(reply, settings);
			await registerMessage(getMessageParams(reply.channel.id, reply.guild!.id, reply.author.id, reply), prismaClient);
		}).then(processed => {
			if (!processed) return processMessage(discordClient, message, prismaClient);
		}).catch(error => console.error('Media preview handler:', error));
		return;
	}
	void processMessage(discordClient, message, prismaClient).catch(error => console.error('Message handler:', error));
});

discordClient.on(Events.MessageDelete, message => {
	if (message.guildId !== allowedGuildId) return;
	messageStats.forget([message.id]).catch(error => console.error('Message stats delete:', error));
});

discordClient.on(Events.MessageBulkDelete, (messages, channel) => {
	if (channel.guildId !== allowedGuildId) return;
	messageStats.forget([...messages.keys()]).catch(error => console.error('Message stats bulk delete:', error));
});

// Slash commands and reaction-channel selector.
discordClient.on(Events.InteractionCreate, async interaction => {
	if (interaction.guildId !== allowedGuildId) return;
	if (interaction.isChatInputCommand()) {
		await processCommand(discordClient, interaction);
	}
	else if ((interaction.isChannelSelectMenu() || interaction.isButton()) &&
		isSelectChannelsComponent(interaction.customId)) {
		await processSelectChannelsComponent(interaction);
	}
	else if (interaction.isButton() && isStatsComponent(interaction.customId)) {
		await processStatsComponent(interaction);
	}
});

// Reactions
discordClient.on(Events.MessageReactionAdd, async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
	if (reaction.message.guildId !== allowedGuildId) return;
	await processReaction(discordClient, reaction, true, user, prismaClient);
});

// Reactions
discordClient.on(Events.MessageReactionRemove, async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
	if (reaction.message.guildId !== allowedGuildId) return;
	await processReaction(discordClient, reaction, false, user, prismaClient);
});

// Importing command definitions must not start a second bot connection.
if (require.main === module) {
	discordClient.login(process.env.DISCORD_BOT_TOKEN);
	const shutdown = async () => {
		try {
			await messageStats.shutdown();
			await discordClient.destroy();
			await prismaClient.$disconnect();
		}
		finally {
			process.exit(0);
		}
	};
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
}
