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
	let destination: string | undefined;
	if (['x.com','www.x.com','mobile.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(host)) {
		platform = 'x'; destination = 'fxtwitter.com';
	} else if (['reddit.com','www.reddit.com','old.reddit.com','new.reddit.com','m.reddit.com'].includes(host)) {
		platform = 'reddit'; destination = 'vxreddit.com';
	} else if (['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'].includes(host)) {
		platform = 'tiktok';
		destination = host.startsWith('vm.') ? 'vm.tnktok.com' :
			host.startsWith('vt.') ? 'vt.tnktok.com' : 'tnktok.com';
	} else if (['instagram.com','www.instagram.com','m.instagram.com'].includes(host) && /^\/(reel|reels|p|tv)\//.test(path)) {
		platform = 'instagram'; destination = 'eeinstagram.com';
	} else if (host === 'bsky.app' && /^\/profile\/[^/]+\/post\//.test(path)) {
		platform = 'bluesky'; destination = 'bskye.app';
	} else if (['youtube.com','www.youtube.com','m.youtube.com'].includes(host) && /^\/shorts\//.test(path)) {
		platform = 'youtube';
		const id = url.pathname.split('/')[2];
		if (!/^[\w-]{11}$/.test(id ?? '')) return null;
		url.hostname = 'www.youtube.com';
		url.pathname = '/watch';
		url.search = '?v=' + id;
		url.hash = '';
	} else if (host === 'clips.twitch.tv' && /^\/[\w-]+\/?$/.test(path)) {
		platform = 'twitch'; destination = 'fxtwitch.seria.moe';
		url.pathname = '/clip' + url.pathname;
	} else if (['twitch.tv','www.twitch.tv','m.twitch.tv'].includes(host) && /\/clip\/[\w-]+\/?$/.test(path)) {
		platform = 'twitch'; destination = 'fxtwitch.seria.moe';
	} else if (['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com'].includes(host) &&
		(/\/(reel|videos|watch|share\/r|share\/v)\//.test(path) || url.searchParams.has('v'))) {
		platform = 'facebook'; destination = 'facebed.seria.moe';
	} else if (host === 'fb.watch') {
		platform = 'facebook'; // Short link: native preview, requires remote redirect to expand.
	} else if (['vimeo.com','www.vimeo.com','player.vimeo.com'].includes(host)) {
		platform = 'vimeo';
	} else if (['streamable.com','www.streamable.com'].includes(host)) {
		platform = 'streamable';
	} else if (['dailymotion.com','www.dailymotion.com','dai.ly'].includes(host)) {
		platform = 'dailymotion';
	} else return null;
	url.protocol = 'https:';
	if (destination) url.hostname = destination;
	url.port = '';
	return { platform, original: raw, fixed: url.toString() };
};

export const findMediaLinks = (content: string): MediaLink[] => {
	const links: MediaLink[] = [];
	const seen = new Set<string>();
	for (const match of (content || '').matchAll(URL_PATTERN)) {
		const candidate = match[0].replace(/[.,!?:;\]\)}'"]+$/g, '');
		const link = mediaLinkFromUrl(candidate);
		if (link && !seen.has(candidate)) { links.push(link); seen.add(candidate); }
		if (links.length >= 3) break;
	}
	return links;
};
// The source URL is used to derive a compact, meaningful post/clip identifier.
export const mediaLabel = (link: MediaLink): string => {
  const platform = link.platform === 'x' ? 'twitter' : link.platform;
  const url = new URL(link.original);
  const segments = url.pathname.split('/').filter(Boolean);
  const after = (...keys: string[]): string | undefined => {
    const index = segments.findIndex((part, i) => i + 1 < segments.length && keys.includes(part.toLowerCase()));
    return index < 0 ? undefined : segments[index + 1];
  };
  let id: string | undefined;
  switch (link.platform) {
    case 'x': id = after('status'); break;
    case 'reddit': id = after('comments'); break;
    case 'tiktok': id = after('video') ?? (/^(vm|vt)\.tiktok\.com$/i.test(url.hostname) ? segments[0] : undefined); break;
    case 'instagram': id = after('reel','reels','p','tv'); break;
    case 'bluesky': id = after('post'); break;
    case 'youtube': id = after('shorts'); break;
    case 'twitch': id = url.hostname === 'clips.twitch.tv' ? segments[0] : after('clip'); break;
    case 'facebook': id = after('reel','videos','r','v') ?? url.searchParams.get('v') ?? undefined;
      if (!id && url.hostname === 'fb.watch') id = segments[0]; break;
    case 'vimeo': id = after('video') ?? segments[0]; break;
    case 'streamable': id = segments[0]; break;
    case 'dailymotion': id = after('video') ?? (url.hostname === 'dai.ly' ? segments[0] : undefined); break;
  }
  // Never inject unsafe punctuation or Markdown into the visible label.
  if (!id || !/^[A-Za-z0-9_-]{2,64}$/.test(id)) return platform;
  return platform + '-' + id + (link.platform === 'tiktok' ? '.mp4' : '');
};

// Inline-code styling inside a masked link; the bot does not upload a media file.
export const proxyEmbedLine = (link: MediaLink): string => {
  const tick = String.fromCharCode(96);
  return '-# [' + tick + mediaLabel(link) + tick + '](' + link.fixed + ')';
};
