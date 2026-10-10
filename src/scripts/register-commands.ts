import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { allowedGuildId } from '../private-server';
import { Commands } from '../constants';
import { mediaMessageCommands } from '../media/interactions';

const register = async () => {
	const token = process.env.DISCORD_BOT_TOKEN;
	const applicationId = process.env.DISCORD_APPLICATION_ID;
	if (!token || !applicationId) throw new Error('DISCORD_BOT_TOKEN ve DISCORD_APPLICATION_ID gereklidir.');
	const rest = new REST({ version: '10' }).setToken(token);
	const commands = [...Commands.map(({ run, ...definition }) => definition), ...mediaMessageCommands];
	await rest.put(Routes.applicationGuildCommands(applicationId, allowedGuildId), { body: commands });
	console.log('WHTBA bot komutları özel sunucuya kaydedildi.');
};
register().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
