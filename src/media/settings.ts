import { ServerSettings } from '../settings/configure';

export interface MediaHelperSettings {
	enabled: boolean;
	allowedChannelIds?: string[];
	// Discord message link previews; on unless explicitly turned off.
	messageLinks?: boolean;
}

export const defaultMediaHelperSettings: MediaHelperSettings = { enabled: true };

export const mediaHelperSettings = (server?: ServerSettings | null): MediaHelperSettings => {
	// Ignore deprecated options stored by older media-conversion versions.
	const saved = server?.mediaHelper;
	const result: MediaHelperSettings = {
		enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
	};
	if (typeof saved?.messageLinks === 'boolean') result.messageLinks = saved.messageLinks;
	if (saved?.allowedChannelIds !== undefined) {
		result.allowedChannelIds = Array.isArray(saved.allowedChannelIds)
			? saved.allowedChannelIds.filter(id => typeof id === 'string' && /^\d{17,20}$/.test(id))
			: [];
	}
	return result;
};

export const messageLinksEnabled = (settings: MediaHelperSettings): boolean => settings.messageLinks !== false;

export const mediaEnabledInChannel = (settings: MediaHelperSettings, channelId: string): boolean =>
	settings.enabled && (settings.allowedChannelIds === undefined || settings.allowedChannelIds.includes(channelId));
