import { ServerSettings } from './configure';

// Treat other bots as eligible authors only after explicit guild opt-in.
// Self-posts always remain excluded to avoid reactions on bot-generated replies.
export const isReactionAuthorAllowed = (
	author: { id?: string; bot?: boolean } | null | undefined,
	ownBotId: string | undefined,
	settings?: Pick<ServerSettings, 'reactToBots'> | null,
): boolean => {
	if (!author?.id || (ownBotId && author.id === ownBotId)) return false;
	return !author.bot || settings?.reactToBots === true;
};
