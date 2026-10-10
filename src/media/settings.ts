import { ServerSettings } from '../settings/configure';

export interface MediaHelperSettings {
	enabled: boolean;
	allowedChannelIds?: string[];
}

export const defaultMediaHelperSettings: MediaHelperSettings = { enabled: true };

export const mediaHelperSettings = (server?: ServerSettings | null): MediaHelperSettings => {
	// Ignore deprecated options stored by older media-conversion versions.
	const saved = server?.mediaHelper;
	const result: MediaHelperSettings = {
		enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
	};
	if (saved?.allowedChannelIds !== undefined) {
		result.allowedChannelIds = Array.isArray(saved.allowedChannelIds)
			? saved.allowedChannelIds.filter(id => typeof id === 'string' && /^\d{17,20}$/.test(id))
			: [];
	}
	return result;
};

export const mediaEnabledInChannel = (settings: MediaHelperSettings, channelId: string): boolean =>
	settings.enabled && (settings.allowedChannelIds === undefined || settings.allowedChannelIds.includes(channelId));
