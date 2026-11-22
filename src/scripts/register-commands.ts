import 'dotenv/config';
import { ApplicationCommandManager, REST, Routes } from 'discord.js';
import { allowedGuildId } from '../private-server';
import { Commands } from '../constants';

const register = async () => {
	const token = process.env.DISCORD_BOT_TOKEN;
	const applicationId = process.env.DISCORD_APPLICATION_ID;
	if (!token || !applicationId) throw new Error('DISCORD_BOT_TOKEN ve DISCORD_APPLICATION_ID gereklidir.');
	const rest = new REST({ version: '10' }).setToken(token);
	// transformCommand converts discord.js option names (minValue, channelTypes...)
	// to the API's snake_case fields; raw camelCase fields are silently ignored.
	const manager = ApplicationCommandManager as unknown as { transformCommand: (data: unknown) => unknown };
	// Drop the bot-only fields (run, adminOnly, ephemeral) before sending.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const commands = Commands.map(({ run, adminOnly, ephemeral, ...definition }) => manager.transformCommand(definition));
	await rest.put(Routes.applicationGuildCommands(applicationId, allowedGuildId), { body: commands });
	console.log('WHTBA bot komutları özel sunucuya kaydedildi.');
};
register().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
