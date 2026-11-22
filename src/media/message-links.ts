import { ChannelType, EmbedBuilder, GuildMember, Message, PermissionFlagsBits } from 'discord.js';

// Previews of Discord message links ("https://discord.com/channels/<guild>/<channel>/<message>"),
// shown like a quote: the link itself (Discord renders it as "#channel ›") followed by an
// embed with the author, text, first image and time of the linked message.

export interface MessageLink {
	url: string;
	guildId: string;
	channelId: string;
	messageId: string;
}

export interface MessagePreview {
	link: MessageLink;
	embed: EmbedBuilder;
}

const MAX_LINKS = 3;
const MESSAGE_LINK = /(<)?https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(>)?/gi;
const PREVIEW_COLOR = 0x5865f2;
const MAX_TEXT = 1800;

// Only links to this server; links wrapped in <...> are left alone, like Discord does.
export const findMessageLinks = (content: string, guildId: string): MessageLink[] => {
	const links: MessageLink[] = [];
	const seen = new Set<string>();
	for (const match of (content || '').matchAll(MESSAGE_LINK)) {
		const [, open, linkGuild, channelId, messageId, close] = match;
		if (open && close) continue;
		if (linkGuild !== guildId || seen.has(messageId)) continue;
		seen.add(messageId);
		links.push({ guildId: linkGuild, channelId, messageId, url: 'https://discord.com/channels/' + linkGuild + '/' + channelId + '/' + messageId });
		if (links.length >= MAX_LINKS) break;
	}
	return links;
};

const isImage = (name: string | null | undefined, contentType: string | null | undefined) =>
	Boolean(contentType?.startsWith('image/')) || /\.(png|jpe?g|gif|webp)$/i.test(name ?? '');

const truncate = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + '…' : text;

export const buildMessagePreview = (target: Message, link: MessageLink): EmbedBuilder => {
	const member = target.member;
	const author = target.author;
	const embed = new EmbedBuilder()
		.setColor(member?.displayColor || PREVIEW_COLOR)
		.setAuthor({
			name: member?.displayName ?? author?.globalName ?? author?.username ?? 'Bilinmeyen',
			iconURL: (member ?? author)?.displayAvatarURL({ size: 64 }),
			url: link.url,
		})
		.setTimestamp(target.createdAt);

	const parts: string[] = [];
	if (target.content) {
		parts.push(target.content);
	}
	else {
		// Bot messages often carry their text in an embed.
		const source = target.embeds[0];
		const text = source?.description ?? source?.title;
		if (text) parts.push(text);
	}
	let image: string | undefined;
	const files: string[] = [];
	for (const attachment of target.attachments.values()) {
		if (!image && isImage(attachment.name, attachment.contentType)) {
			image = attachment.url;
		}
		else {
			files.push('📎 [' + truncate(attachment.name ?? 'dosya', 60) + '](' + attachment.url + ')');
		}
	}
	image ??= target.embeds.map(item => item.image?.url ?? item.thumbnail?.url).find(Boolean) ?? undefined;
	if (!image && target.stickers.size) image = target.stickers.first()?.url;
	if (files.length) parts.push(files.slice(0, 5).join('\n'));
	const description = truncate(parts.join('\n\n'), MAX_TEXT);
	if (description) embed.setDescription(description);
	if (image) embed.setImage(image);
	if (!description && !image) embed.setDescription('*İçerik görüntülenemiyor.*');
	return embed;
};

const isNsfw = (channel: any): boolean => Boolean(channel?.nsfw || channel?.parent?.nsfw);

// The member who posted the link must be able to read the linked message, so the bot
// never reveals private channels. NSFW content is only shown in NSFW channels.
export const canPreview = (target: any, source: any, member: GuildMember | null | undefined): boolean => {
	if (!member || !target?.isTextBased?.() || !('messages' in target)) return false;
	const permissions = target.permissionsFor?.(member);
	if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) return false;
	return !isNsfw(target) || isNsfw(source);
};

// Private threads are visible only to their members and to moderators.
const canReadPrivateThread = async (channel: any, member: GuildMember): Promise<boolean> => {
	if (channel.type !== ChannelType.PrivateThread) return true;
	if (channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageThreads)) return true;
	try {
		await channel.members.fetch(member.id);
		return true;
	}
	catch {
		return false;
	}
};

export const resolveMessagePreviews = async (message: Message, links: MessageLink[]): Promise<MessagePreview[]> => {
	const previews: MessagePreview[] = [];
	for (const link of links) {
		try {
			const channel: any = await message.client.channels.fetch(link.channelId);
			if (!channel || channel.guildId !== message.guildId || !canPreview(channel, message.channel, message.member)) continue;
			if (!await canReadPrivateThread(channel, message.member!)) continue;
			const target: Message = await channel.messages.fetch(link.messageId);
			previews.push({ link, embed: buildMessagePreview(target, link) });
		}
		catch {
			// Deleted message, deleted channel or no access for the bot: no preview.
		}
	}
	return previews;
};
