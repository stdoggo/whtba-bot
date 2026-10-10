import axios from 'axios';
import { AttachmentBuilder, Message } from 'discord.js';

export type SocialPlatform = 'x' | 'reddit' | 'tiktok';
export interface SocialLink {
	platform: SocialPlatform;
	original: string;
	fixed: string;
}

const LINK_REGEX = /https?:\/\/[^\s<>]+/gi;
const MAX_LINKS = 3;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

export const findSocialLinks = (content: string): SocialLink[] => {
	if (!content) return [];
	const found: SocialLink[] = [];
	const seen = new Set<string>();
	for (const match of content.matchAll(LINK_REGEX)) {
		const original = match[0].replace(/[.,!?:;\]\)}'"]+$/g, '');
		if (seen.has(original)) continue;
		let url: URL;
		try { url = new URL(original); } catch { continue; }
		if (!['http:', 'https:'].includes(url.protocol)) continue;
		const host = url.hostname.toLowerCase();
		let platform: SocialPlatform;
		let destination: string;
		if (['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) {
			platform = 'x';
			destination = 'fxtwitter.com';
		}
		else if (['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'm.reddit.com'].includes(host)) {
			platform = 'reddit';
			destination = 'vxreddit.com';
		}
		else if (['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(host)) {
			platform = 'tiktok';
			destination = 'd.tnktok.com';
		}
		else continue;
		url.protocol = 'https:';
		url.hostname = destination;
		url.port = '';
		seen.add(original);
		found.push({ platform, original, fixed: url.toString() });
		if (found.length === MAX_LINKS) break;
	}
	return found;
};

// Discord -# subtext makes the source link smaller; angle brackets prevent its own embed.
export const sourceLinkText = (link: SocialLink): string =>
	'-# [View original](<' + link.original + '>)';

export const fixedLinkText = (link: SocialLink): string =>
	sourceLinkText(link) + '\n-# ' + link.fixed;

const videoFilename = (url: string, id: string): string => {
	let shortCode = '';
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split('/').filter(Boolean);
		if (/^(vt|vm)\.tiktok\.com$/i.test(parsed.hostname)) shortCode = parts[0] || '';
	} catch { /* Retain resolved video ID. */ }
	const basename = /^[a-z0-9_-]{3,40}$/i.test(shortCode) ? shortCode : id;
	return 'tik-' + basename + '.mp4';
};

// Best-effort public-video extraction using TikWM. Only fetch a fixed TikWM
// endpoint with a validated numeric ID, never an arbitrary URL from its response.
export const downloadTikTokVideo = async (original: string): Promise<AttachmentBuilder | null> => {
	try {
		const form = new URLSearchParams({ url: original, hd: '0' });
		const metadata = await axios.post('https://www.tikwm.com/api/', form.toString(), {
			timeout: 12000,
			maxContentLength: 512 * 1024,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 WHTBABot/1.0' },
		});
		const data = metadata.data?.data;
		const id = String(data?.id ?? '');
		if (metadata.data?.code !== 0 || !/^\d{15,25}$/.test(id) || !data?.play ||
			(Array.isArray(data.images) && data.images.length > 0)) return null;
		const source = 'https://www.tikwm.com/video/media/play/' + id + '.mp4';
		const media = await axios.get<ArrayBuffer>(source, {
			responseType: 'arraybuffer',
			timeout: 20000,
			maxContentLength: MAX_VIDEO_BYTES,
			maxBodyLength: MAX_VIDEO_BYTES,
		});
		const dataBuffer = Buffer.from(media.data);
		if (!dataBuffer.length || dataBuffer.length > MAX_VIDEO_BYTES) return null;
		const mime = String(media.headers['content-type'] ?? '').toLowerCase();
		if (mime && !mime.includes('video/') && !mime.includes('octet-stream')) return null;
		return new AttachmentBuilder(dataBuffer, { name: videoFilename(original, id) });
	} catch (error) {
		console.warn('TikTok download unavailable; using direct embed fallback:', error instanceof Error ? error.message : error);
		return null;
	}
};

export const handleSocialLinks = async (message: Message, links: SocialLink[] = findSocialLinks(message.content)) => {
	if (!message.guildId || message.author?.bot || !links.length) return;
	const noPing = { parse: [] as [], repliedUser: false };
	// Multiple links use native link players; a single TikTok is reuploaded when possible.
	const tiktok = links.length === 1 && links[0].platform === 'tiktok' ? links[0] : undefined;
	const attachment = tiktok ? await downloadTikTokVideo(tiktok.original) : null;
	let didReply = false;
	if (attachment && tiktok) {
		try {
			await message.reply({ content: sourceLinkText(tiktok), files: [attachment], allowedMentions: noPing });
			didReply = true;
		} catch (error) {
			console.warn('TikTok upload failed; using embed fallback:', error instanceof Error ? error.message : error);
		}
	}
	if (!didReply) {
		await message.reply({
			content: links.map(fixedLinkText).join('\n'),
			allowedMentions: noPing,
		});
		didReply = true;
	}
	if (didReply) {
		// Manage Messages is required to suppress embeds on someone else's message.
		try { await message.suppressEmbeds(true); }
		catch (error) {
			console.warn('Original preview could not be suppressed (Manage Messages required):', error instanceof Error ? error.message : error);
		}
	}
};
