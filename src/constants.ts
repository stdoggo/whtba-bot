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

import { help } from './commands/help';
import { setupserver } from './commands/setupserver';
import { setupchannel } from './commands/setupchannel';
import { selectChannels } from './commands/select-channels';
export const Commands: Command[] = [help, setupserver, setupchannel, selectChannels];

export const NOT_REGISTERED_MESSAGE = 'Server is not registered ❌\nPlease run `/setupserver` to register this server';
export const HELP_MESSAGE = 'WHTBA bot — özel sunucu medya beğeni botu.' +
'\n`/setupserver` Sunucu ayarlarını oluşturur veya günceller.' +
'\n`/setupserver like-reaction:👍 dislike-reaction:👎` Tepki emojilerini belirler.' +
'\n`/setupserver allow-embed-reactions:Allow all` Bağlantı önizlemelerine de tepki ekler.' +
'\n`/setupchannel` Bu kanalın medya ve yazı kurallarını düzenler.' +
'\n`/select-channels` Emoji eklenecek kanalları çoklu seçimle yönetir.' +
'\n`/setupchannel forbid-text:Messages must contain content` Medyasız mesajları siler.' +
'\nAyarları değiştirmek için Sunucuyu Yönet yetkisi gerekir. Yardım için sunucu yöneticisine başvur.';
