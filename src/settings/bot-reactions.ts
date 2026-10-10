import { ServerSettings } from './configure';

// Only our own converted Media-Helper replies may be voted on; other WHTBA messages stay excluded.
export const isFixedMediaReplyContent = (content: string | null | undefined): boolean => {
	const text = content ?? '';
	// New compact replies: only named external media links. Leave other WHTBA
	// messages excluded from voting even when react-to-bots is enabled.
	const compact = /^-# \[(tiktok-[\w-]+\.mp4|tiktok|twitter|reddit|instagram|bluesky|youtube|twitch|facebook|vimeo|streamable|dailymotion)\]\((https:\/\/[^\s)]+)\)/.exec(text);
	if (compact) {
		try {
			const host = new URL(compact[2]).hostname.toLowerCase();
			const hosts: Record<string, string[]> = {
				tiktok: ['tnktok.com', 'vm.tnktok.com', 'vt.tnktok.com'],
				twitter: ['fxtwitter.com'],
				reddit: ['vxreddit.com'],
				instagram: ['eeinstagram.com'],
				bluesky: ['bskye.app'],
				youtube: ['www.youtube.com'],
				twitch: ['fxtwitch.seria.moe'],
				facebook: ['facebed.seria.moe', 'fb.watch'],
				vimeo: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
				streamable: ['streamable.com', 'www.streamable.com'],
				dailymotion: ['dailymotion.com', 'www.dailymotion.com', 'dai.ly'],
			};
			const platform = compact[1].startsWith('tiktok-') ? 'tiktok' : compact[1];
			return hosts[platform]?.includes(host) ?? false;
		} catch { return false; }
	}
	// Previously posted View original formats still count in existing threads.
	return /^-# \[View original\]\(<https?:\/\/[^\s<>]+>\)(?: · \[[^\n\]]{1,100}\]\(https?:\/\/[^\s)]+\)|\n-# https?:\/\/[^\s<>]+)/.test(text);
};
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
