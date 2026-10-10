import { ServerSettings } from '../settings/configure';

export interface MediaHelperSettings {
	enabled: boolean;
	quickActions: boolean;
	ephemeralReplies: boolean;
	autoUpload: boolean;
	soundboard: boolean;
	allowedChannelIds?: string[];
}

export const defaultMediaHelperSettings: MediaHelperSettings = {
	enabled: true,
	quickActions: true,
	ephemeralReplies: false,
	autoUpload: true,
	soundboard: true,
};

export const mediaHelperSettings = (settings?: ServerSettings | null): MediaHelperSettings => {
	const customized = settings?.mediaHelper;
	const merged = { ...defaultMediaHelperSettings, ...(customized || {}) };
	if (merged.allowedChannelIds !== undefined) {
		merged.allowedChannelIds = Array.isArray(merged.allowedChannelIds) ?
			merged.allowedChannelIds.filter(id => typeof id === 'string' && /^\d{17,20}$/.test(id)) : [];
	}
	return merged;
};

export const mediaEnabledInChannel = (settings: MediaHelperSettings, channelId: string): boolean =>
	settings.enabled && (settings.allowedChannelIds === undefined || settings.allowedChannelIds.includes(channelId));
