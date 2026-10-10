import { Client, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { getServerSettings } from '../queries/get-server-settings';
import { isReactionChannelAllowed } from '../settings/reaction-channels';
import { isReactionAuthorAllowed } from '../settings/bot-reactions';
import { numberExtractRegex } from '../utils';
import { registerMessage, dislikeAdd, likeAdd, likeRemove, dislikeRemove, RegisterMessageParams } from '../queries/register-message';
import { getMessageParams } from './message';


export const processReaction = async (client: Client, reaction: MessageReaction | PartialMessageReaction, added: boolean, user: User | PartialUser, prisma: any) => {
	// Bot votes remain excluded; people can vote on other bots' posts when enabled.
	if(user?.bot) return;
	let m = reaction?.message;
	if (!m) return;
	if (m.partial) m = await m.fetch();
	if (!m || !m.author) return;

	const cache = m.reactions?.cache;
	if (!cache) return;

	const serverId = m.guild?.id;
	if (!serverId) return;
	const serverSettings = await getServerSettings(serverId, prisma);
	if (!serverSettings || !isReactionChannelAllowed(serverSettings.settings, m.channel.id) ||
		!isReactionAuthorAllowed(m.author, client.user?.id, serverSettings.settings, m.content)) return;

	const likeReaction : string = serverSettings?.settings?.likeReaction;
	const dislikeReaction : string = serverSettings?.settings?.dislikeReaction;
	const likeEmojiExtraction = likeReaction?.match(numberExtractRegex)?.at(0) ?? likeReaction;
	const dislikeEmojiExtraction = dislikeReaction?.match(numberExtractRegex)?.at(0) ?? dislikeReaction;

	const params = await getMessageParams(m.channel?.id, serverId, m.author?.id, m);
	let r;
	if(reaction.partial) r = await reaction.fetch();
	else r = reaction;

	params.likeCount = cache.get(likeEmojiExtraction)?.count ?? 0;
	params.dislikeCount = cache.get(dislikeEmojiExtraction)?.count ?? 0;
	params.interactions = cache.reduce((total, item) => total + item.count, 0);

	if(r?.emoji?.id) {
		const reactionEmojiExtraction = r?.emoji?.id?.match(numberExtractRegex);
		if (reactionEmojiExtraction?.length) {
			const reactionEmojiId = reactionEmojiExtraction[0];
			emojiSubmissionHandler(added, reactionEmojiId, dislikeEmojiExtraction, likeEmojiExtraction, params, prisma);
		}
	}
	else if (r?.emoji?.name) {
		const emojiName = r?.emoji?.name;
		emojiSubmissionHandler(added, emojiName, dislikeReaction, likeReaction, params, prisma);
	}
	return;

	// console.log(stringifyJSONWithBigIntSupport(reaction));
	// if (reaction?.emoji) console.log('Emoji ID: ' + reaction?.emojiId);
	// console.log("Count: " reaction.message.reactions.cache.get(reaction.emoji.name).count);
};

const emojiSubmissionHandler = (added: boolean, emojiStr: string, dislike: string, like: string, params: RegisterMessageParams, prisma: any) => {
	switch (added) {
		case true:
			if (emojiStr === like) {
				likeAdd(params, prisma);
			}
			else if (emojiStr === dislike) {
				dislikeAdd(params, prisma);
			}
			else {
				registerMessage(params, prisma);
			}
			break;
		default:
			if (emojiStr === like) {
				likeRemove(params, prisma);
			}
			else if (emojiStr === dislike) {
				dislikeRemove(params, prisma);
			}
			else {
				registerMessage(params, prisma);
			}
			break;
	}

};
