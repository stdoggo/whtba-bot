import { ServerSettings } from './configure';

// Undefined means the server has not configured a channel filter yet (legacy behavior).
// An explicit empty array means no automatic reactions in any channel.
export const getReactionChannelIds = (settings: ServerSettings | null | undefined): string[] | undefined => {
	if (!Array.isArray(settings?.reactionChannelIds)) return undefined;
	return settings.reactionChannelIds.filter(id => typeof id === 'string' && /^\d{17,20}$/.test(id));
};

export const isReactionChannelAllowed = (settings: ServerSettings | null | undefined, channelId: string): boolean => {
	const ids = getReactionChannelIds(settings);
	return ids === undefined || ids.includes(channelId);
};

export const changeReactionChannels = (
	current: string[] | undefined,
	chosen: string[],
	action: 'add' | 'remove' | 'clear',
): string[] => {
	const existing = current ?? [];
	if (action === 'clear') return [];
	if (action === 'remove') return existing.filter(id => !chosen.includes(id));
	return [...new Set([...existing, ...chosen])];
};
