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
import { isSelectChannelsComponent, processSelectChannelsComponent } from './commands/select-channels';
import { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaRedisCache } from 'prisma-redis-middleware';

// Postgres connection
export const prismaClient = new PrismaClient();

// https://github.com/Asjas/prisma-redis-middleware
const cacheMiddleware: Prisma.Middleware = createPrismaRedisCache({
	models: [
		// Time is in seconds
		{ model: 'WorldUser', cacheTime: 60 },
		{ model: 'LocalUser', cacheTime: 60 },
		{ model: 'World', cacheTime: 9999 },
		{ model: 'Server', cacheTime: 9999 },
		{ model: 'ServerSettings', cacheTime: 9999 },
		{ model: 'ChannelSettings', cacheTime: 9999 },
	],
	storage: { type: 'memory', options: { size: 2048, invalidation: true } },
	cacheTime: 300,
	excludeModels: ['Message'],
	excludeMethods: [],
	// onHit: (key) => {
	// 	console.log('hit', key);
	// },
	// onMiss: (key) => {
	// 	console.log('miss', key);
	// },
	// onError: (key) => {
	// 	console.log('error', key);
	// },
});


prismaClient.$use(cacheMiddleware);

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

discordClient.once('ready', async () => {
	processLoad(discordClient, prismaClient).then(async () => {
		await prismaClient.$disconnect();
	}).catch(async (e) => {
		console.error(e);
		await prismaClient.$disconnect();
		process.exit(1);
	});
});

// List of Discord Events -> https://old.discordjs.dev/#/docs/discord.js/14.11.0/typedef/Events
// Messages
discordClient.on(Events.MessageCreate, (message: any) => {
	if (message.guildId !== allowedGuildId) return;
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

// Slash commands and reaction-channel selector.
discordClient.on(Events.InteractionCreate, async interaction => {
	if (interaction.guildId !== allowedGuildId) return;
	if (interaction.isChatInputCommand()) {
		await processCommand(discordClient, interaction);
	} else if ((interaction.isChannelSelectMenu() || interaction.isButton()) &&
		isSelectChannelsComponent(interaction.customId)) {
		await processSelectChannelsComponent(interaction);
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
}
