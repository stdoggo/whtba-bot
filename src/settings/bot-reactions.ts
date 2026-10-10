import { ServerSettings } from './configure';

// Only our own converted Media-Helper replies may be voted on; other WHTBA messages stay excluded.
export const isFixedMediaReplyContent = (content: string | null | undefined): boolean =>
	// Match both compact replies and older two-line replies.
	/^-# \[View original\]\(<https?:\/\/[^\s<>]+>\)(?: · \[[^\n\]]{1,100}\]\(https?:\/\/[^\s)]+\)|\n-# https?:\/\/[^\s<>]+)/.test(content ?? '');
export const isReactionAuthorAllowed = (
	author: { id?: string; bot?: boolean } | null | undefined,
	ownBotId: string | undefined,
	settings?: Pick<ServerSettings, 'reactToBots'> | null,
	content?: string | null,
): boolean => {
	if (!author?.id) return false;
	if (ownBotId && author.id === ownBotId) {
		return settings?.reactToBots === true && isFixedMediaReplyContent(content);
	}
	return !author.bot || settings?.reactToBots === true;
};
