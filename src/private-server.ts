import 'dotenv/config';
export const allowedGuildId = process.env.DISCORD_GUILD_ID ?? '';
if (!/^\d{17,20}$/.test(allowedGuildId)) {
	throw new Error('WHTBA bot: .env içinde geçerli bir DISCORD_GUILD_ID belirt.');
}
