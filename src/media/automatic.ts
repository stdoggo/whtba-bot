import { Message } from 'discord.js';
import { getServerSettings } from '../queries/get-server-settings';
import { MediaHelperSettings, defaultMediaHelperSettings, mediaHelperSettings, mediaEnabledInChannel, messageLinksEnabled } from './settings';
import { MessageLink, MessagePreview, resolveMessagePreviews } from './message-links';
import { findMediaLinks, MediaLink, proxyEmbedLine } from './sites';
import { isReactionChannelAllowed } from '../settings/reaction-channels';
import { ServerSettings } from '../settings/configure';

// Do not download or re-encode media. Discord unfurls the third-party URLs.
export type FixedMediaReplyHandler = (reply: Message, settings: ServerSettings) => Promise<void>;

export interface AutomaticMediaOptions {
	// Discord message links found in the message (see findMessageLinks).
	messageLinks?: MessageLink[];
	resolvePreviews?: (message: Message, links: MessageLink[]) => Promise<MessagePreview[]>;
}

export const handleAutomaticMedia = async (
	message: Message,
	prisma: any,
	links: MediaLink[] = findMediaLinks(message.content),
	onFixedReply?: FixedMediaReplyHandler,
	options: AutomaticMediaOptions = {},
): Promise<boolean> => {
	const messageLinks = options.messageLinks ?? [];
	if (!message.guildId || message.author?.bot || (!links.length && !messageLinks.length)) return false;
	let serverSettings: ServerSettings | undefined;
	let preferences: MediaHelperSettings = defaultMediaHelperSettings;
	try {
		const record = await getServerSettings(message.guildId, prisma);
		serverSettings = record?.settings as ServerSettings | undefined;
		preferences = mediaHelperSettings(serverSettings);
		if (!mediaEnabledInChannel(preferences, message.channelId)) return false;
	} catch (error) {
		// Existing servers with unavailable settings still use all-channel defaults.
		console.warn('Media settings unavailable, using defaults:', error);
	}
	const previews = messageLinks.length && messageLinksEnabled(preferences)
		? await (options.resolvePreviews ?? resolveMessagePreviews)(message, messageLinks)
		: [];
	if (!links.length && !previews.length) return false;
	// The message link is shown first (Discord renders it as "#channel ›"), its preview below.
	const reply = await message.reply({
		content: [...links.map(proxyEmbedLine), ...previews.map(preview => preview.link.url)].join('\n\n'),
		embeds: previews.map(preview => preview.embed),
		allowedMentions: { parse: [], repliedUser: false },
	});
	// Message link previews have no original embed to replace and get no votes.
	if (!links.length) return true;
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
