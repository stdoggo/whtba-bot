import { CommandInteraction, ChatInputApplicationCommandData, ChatInputCommandInteraction, Client } from 'discord.js';
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
    // Defaults to true: only members with Manage Server may use the command.
    adminOnly?: boolean;
    // Defaults to true: the reply is visible only to the member who ran the command.
    ephemeral?: (interaction: ChatInputCommandInteraction) => boolean;
}

import { embedSettings } from './commands/embed';
import { reactionSettings } from './commands/reaction';
import { stats } from './commands/stats';
export const Commands: Command[] = [embedSettings, reactionSettings, stats];

export const NOT_REGISTERED_MESSAGE = 'Sunucu henüz kayıtlı değil. /reaction server komutunu kullan.';
