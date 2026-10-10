import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Message } from 'discord.js';
import { getServerSettings } from '../queries/get-server-settings';
import { mediaHelperSettings, mediaEnabledInChannel, MediaHelperSettings } from './settings';
import { findMediaLinks, MediaLink, originalLinkLine, proxyEmbedLine } from './sites';
import { normalizeOptions, runConversion } from './engine';

const actionButtons = (id: string) => new ActionRowBuilder<ButtonBuilder>().addComponents(
	new ButtonBuilder().setCustomId('whtba:media:mp3:' + id).setLabel('MP3').setStyle(ButtonStyle.Secondary),
	new ButtonBuilder().setCustomId('whtba:media:gif:' + id).setLabel('GIF').setStyle(ButtonStyle.Secondary),
	new ButtonBuilder().setCustomId('whtba:media:trim:' + id).setLabel('Trim').setStyle(ButtonStyle.Secondary),
	new ButtonBuilder().setCustomId('whtba:media:mute:' + id).setLabel('Mute').setStyle(ButtonStyle.Secondary),
	new ButtonBuilder().setCustomId('whtba:media:caption:' + id).setLabel('Caption').setStyle(ButtonStyle.Secondary),
);
export const mediaActionRow = (id: string) => actionButtons(id);

const shouldDownload = (link: MediaLink): boolean =>
	!['x','reddit','instagram','bluesky'].includes(link.platform);

const formatReply = (links: MediaLink[]) => links.map(proxyEmbedLine).join('\n\n');

export const handleAutomaticMedia = async (message: Message, prisma: any, links: MediaLink[] = findMediaLinks(message.content)): Promise<boolean> => {
	if (!message.guildId || message.author?.bot || !links.length) return false;
	let settings: MediaHelperSettings;
	try {
		const stored = await getServerSettings(message.guildId, prisma);
		settings = mediaHelperSettings(stored?.settings);
	} catch (error) {
		console.warn('Could not load media preferences:', error);
		settings = mediaHelperSettings();
	}
	if (!mediaEnabledInChannel(settings, message.channelId)) return false;
	const components = settings.quickActions && links.length === 1 ? [actionButtons(message.id)] : [];
	const allowedMentions = { parse: [] as [], repliedUser: false };

	let posted = false;
	if (settings.autoUpload && links.length === 1 && shouldDownload(links[0])) {
		try {
			const file = await runConversion(links[0].original, normalizeOptions('mp4', '', '45'));
			await message.reply({
				content: originalLinkLine(links[0].original),
				files: [new AttachmentBuilder(file.buffer, { name: file.filename })],
				components, allowedMentions,
			});
			posted = true;
		} catch (error) {
			console.warn('Native media preview unavailable:', error instanceof Error ? error.message : error);
		}
	}
	if (!posted) {
		await message.reply({ content: formatReply(links), allowedMentions, components });
		posted = true;
	}
	if (posted) {
		try { await message.suppressEmbeds(true); }
		catch (error) {
			console.warn('Missing Manage Messages permission for suppressEmbeds:', error instanceof Error ? error.message : error);
		}
	}
	return posted;
};
