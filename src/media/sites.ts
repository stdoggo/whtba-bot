export type SupportedSite = 'x' | 'reddit' | 'tiktok' | 'instagram' | 'bluesky' |
	'youtube' | 'twitch' | 'facebook' | 'vimeo' | 'streamable' | 'dailymotion';

export interface MediaLink {
	platform: SupportedSite;
	original: string;
	fixed: string;
}
const URL_PATTERN = /https?:\/\/[^\s<>]+/gi;

export const mediaLinkFromUrl = (raw: string): MediaLink | null => {
	let url: URL;
	try { url = new URL(raw); } catch { return null; }
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	const host = url.hostname.toLowerCase();
	const path = url.pathname.toLowerCase();
	let platform: SupportedSite;
	let replacement: string | undefined;
	if (['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) {
		platform = 'x'; replacement = 'fxtwitter.com';
	} else if (['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'm.reddit.com', 'redd.it', 'www.redd.it'].includes(host)) {
		platform = 'reddit'; replacement = 'vxreddit.com';
	} else if (['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com'].includes(host)) {
		platform = 'tiktok'; replacement = 'd.tnktok.com';
	} else if (['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(host) && /^\/(reel|reels|p|tv)\//.test(path)) {
		platform = 'instagram'; replacement = 'deinstagram.com';
	} else if (host === 'bsky.app' && /^\/profile\/[^/]+\/post\//.test(path)) {
		platform = 'bluesky'; replacement = 'bskye.app';
	} else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host) && /^\/shorts\/[^/]+/.test(path)) {
		platform = 'youtube';
		const id = url.pathname.split('/')[2];
		if (!/^[\w-]{11}$/.test(id || '')) return null;
		url.pathname = '/watch';
		url.search = '?v=' + id;
		url.hash = '';
	} else if (host === 'clips.twitch.tv' || ((host === 'www.twitch.tv' || host === 'twitch.tv') && /\/clip\//.test(path))) {
		platform = 'twitch';
	} else if (['facebook.com','www.facebook.com','m.facebook.com','fb.watch'].includes(host) &&
		(/\/(reel|videos|watch)\//.test(path) || host === 'fb.watch' || url.searchParams.has('v'))) {
		platform = 'facebook';
	} else if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
		platform = 'vimeo';
	} else if (host === 'streamable.com' || host === 'www.streamable.com') {
		platform = 'streamable';
	} else if (host === 'dailymotion.com' || host === 'www.dailymotion.com' || host === 'dai.ly') {
		platform = 'dailymotion';
	} else return null;
	url.protocol = 'https:';
	if (replacement) url.hostname = replacement;
	url.port = '';
	return { platform, original: raw, fixed: url.toString() };
};

export const findMediaLinks = (content: string): MediaLink[] => {
	const links: MediaLink[] = [];
	const seen = new Set<string>();
	for (const match of (content || '').matchAll(URL_PATTERN)) {
		const candidate = match[0].replace(/[.,!?:;\]\)}'"]+$/g, '');
		const link = mediaLinkFromUrl(candidate);
		if (link && !seen.has(candidate)) {
			links.push(link); seen.add(candidate);
		}
		if (links.length >= 3) break;
	}
	return links;
};

export const originalLinkLine = (url: string): string => '-# [View original](<' + url + '>)';
export const proxyEmbedLine = (link: MediaLink): string => originalLinkLine(link.original) + '\n-# ' + link.fixed;
