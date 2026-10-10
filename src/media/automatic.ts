import { Message } from 'discord.js';
import { getServerSettings } from '../queries/get-server-settings';
import { mediaHelperSettings, mediaEnabledInChannel } from './settings';
import { findMediaLinks, MediaLink, proxyEmbedLine } from './sites';

// Do not download or re-encode media. Discord unfurls the third-party URLs.
export const handleAutomaticMedia = async (
	message: Message,
	prisma: any,
	links: MediaLink[] = findMediaLinks(message.content),
): Promise<boolean> => {
	if (!message.guildId || message.author?.bot || !links.length) return false;
	try {
		const record = await getServerSettings(message.guildId, prisma);
		if (!mediaEnabledInChannel(mediaHelperSettings(record?.settings), message.channelId)) return false;
	} catch (error) {
		// Existing servers with unavailable settings still use all-channel defaults.
		console.warn('Media settings unavailable, using defaults:', error);
	}
	await message.reply({
		content: links.map(proxyEmbedLine).join('\n\n'),
		allowedMentions: { parse: [], repliedUser: false },
	});
	try { await message.suppressEmbeds(true); }
	catch (error) {
		console.warn('Cannot suppress original embed (Manage Messages needed):',
			error instanceof Error ? error.message : error);
	}
	return true;
};
