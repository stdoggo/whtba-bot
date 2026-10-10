import { CommandInteraction, ChatInputApplicationCommandData, Client } from 'discord.js';
export const LIKE = '👍';
export const DISLIKE = '👎';
export const UNKNOWN = '❓';

export interface upsertParams {
    modelName: string;
    uniqueId: string | bigint | number;
    kvpArray: kvp [];
    prisma: any;
}

export interface upsertParamsSpecial {
    modelName: string;
    uniqueId: string | bigint | number;
    kvpArrayCreate: kvp [];
    kvpArrayUpdate: kvp [];
    prisma: any;
}

export interface findByIdParams {
    modelName: string;
    kvpArray: kvp [];
    prisma: any;
}

export interface kvp {
    k: string;
    v: any;
}


export interface Command extends ChatInputApplicationCommandData {
    run: (client: Client, interaction: CommandInteraction) => void;
}

import { embedSettings } from './commands/embed-settings';
import { reactionSettings } from './commands/reaction-settings';
export const Commands: Command[] = [embedSettings, reactionSettings];

export const NOT_REGISTERED_MESSAGE = 'Sunucu henüz kayıtlı değil. /reaction-settings server komutunu kullan.';
