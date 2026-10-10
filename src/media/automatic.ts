import { Message } from 'discord.js';
import { getServerSettings } from '../queries/get-server-settings';
import { mediaHelperSettings, mediaEnabledInChannel } from './settings';
import { findMediaLinks, MediaLink, proxyEmbedLine } from './sites';
import { isReactionChannelAllowed } from '../settings/reaction-channels';
import { ServerSettings } from '../settings/configure';

// Do not download or re-encode media. Discord unfurls the third-party URLs.
export type FixedMediaReplyHandler = (reply: Message, settings: ServerSettings) => Promise<void>;
export const handleAutomaticMedia = async (
	message: Message,
	prisma: any,
	links: MediaLink[] = findMediaLinks(message.content),
	onFixedReply?: FixedMediaReplyHandler,
): Promise<boolean> => {
	if (!message.guildId || message.author?.bot || !links.length) return false;
	let serverSettings: ServerSettings | undefined;
	try {
		const record = await getServerSettings(message.guildId, prisma);
		serverSettings = record?.settings as ServerSettings | undefined;
		if (!mediaEnabledInChannel(mediaHelperSettings(serverSettings), message.channelId)) return false;
	} catch (error) {
		// Existing servers with unavailable settings still use all-channel defaults.
		console.warn('Media settings unavailable, using defaults:', error);
	}
	const reply = await message.reply({
		content: links.map(proxyEmbedLine).join('\n\n'),
		allowedMentions: { parse: [], repliedUser: false },
	});
	// Only converted replies receive WHTBA's own reactions, never ordinary bot messages.
	if (onFixedReply && serverSettings?.reactToBots === true &&
		isReactionChannelAllowed(serverSettings, message.channelId)) {
		try { await onFixedReply(reply, serverSettings); }
		catch (error) {
			console.error('Failed to add reactions to converted reply:', error);
		}
	}
	try { await message.suppressEmbeds(true); }
	catch (error) {
		console.warn('Cannot suppress original embed (Manage Messages needed):',
			error instanceof Error ? error.message : error);
	}
	return true;
};
