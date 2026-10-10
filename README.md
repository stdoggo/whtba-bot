# WHTBA bot

Private Discord bot configured for one server using `DISCORD_GUILD_ID`. Adds custom like/dislike reactions to selected media channels and fixes broken social previews with **external embed links only**.

## Supported links

| Site | Strategy |
| --- | --- |
| X / Twitter | `fxtwitter.com` |
| Reddit | `vxreddit.com` |
| TikTok, including short `vm` and `vt` links | `tnktok.com` / `vm.tnktok.com` / `vt.tnktok.com` |
| Instagram Reels/posts | `eeinstagram.com` |
| Bluesky | `bskye.app` |
| Twitch clips | `fxtwitch.seria.moe` |
| Facebook videos/Reels | `facebed.seria.moe` for full links |
| YouTube Shorts | Standard YouTube `watch?v=` playable link |
| Vimeo, Streamable, Dailymotion, `fb.watch` | Original/native URL (if the platform supplies a Discord preview) |

On new human-authored messages, the bot replies without pinging the sender, includes the original link as a compact **View original** Markdown link, and tries to hide the original preview. Up to three URLs per message are supported. Link fixing defaults to **all channels** independently of emoji reaction channel selections.

## Commands

All slash commands require Manage Server permission:
- `/setupserver`: register server and configure like/dislike emojis, supported embed reactions and `react-to-bots:true/false` (default `false`). When enabled, it covers other bots' media posts **and WHTBA's own converted-link replies**.
- `/select-channels`: manage channels where 👍/👎 reactions are added. This does not affect the external-link preview handler.
- `/setupchannel`: adjust channel moderation and embed-reaction preferences.
- `/settings`: configure link preview enable/disable and its optional channel allowlist; `action:enabled enabled:false` disables fixes, `action:channel-add channel:#channel` starts/extends the allowlist, `action:channel-remove channel:#channel` removes a selection, and `action:channel-all` restores all channels.
- `/help`: view basic usage.

The old video/audio converter, quick-action buttons, media uploads and soundboard integration have been removed. Former context commands **Convert media** and **Upload to soundboard** are unregistered by running `npm run updatecommands`. No media download or local conversion utilities are needed.

## Setup on Windows

Requirements: Node.js/npm, PostgreSQL and an existing `.env` with `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, `DATABASE_URL`.

```bat
cd /d D:\whtba-bot
git pull origin main
npm install
npx prisma generate
npm run build
npm test
npm run updatecommands
npm start
```

**Discord permissions**: View Channel, Read Message History, Send Messages, Embed Links, and Manage Messages (for suppressing the original embed). Enable the Message Content Intent. Attach Files and Create Expressions are not required by these previews.

## Notes

- Media is neither downloaded nor re-encoded. The bot only posts URLs; Discord and external embed providers handle preview generation.
- Proxy uptime and playback support vary, and some videos may only appear as simple links.
- Link fixing uses its own optional channel allowlist, while reaction controls use `/select-channels`.
- `/setupserver react-to-bots:true` adds reactions to eligible attachments/embeds from **other bots** and to **WHTBA's own converted-link replies**. Other WHTBA messages stay excluded. The toggle defaults to disabled. `/select-channels` limits these reactions, but link fixing itself remains independent. Human votes on eligible bot posts and WHTBA's converted replies are counted; votes cast by other bots remain ignored.
- PostgreSQL stores server/channel settings and reaction counters. Old converter setting fields in the server JSON are ignored and cleaned when `/settings` saves updated preferences.
- Events are processed only while the bot is running; past missed messages are not retroactively scanned.
- Bot/user/message IDs stored by the original reaction tracking system remain unchanged.

## Development

```sh
npm run build
npm test
```

Project files are organized under `src/`; database models are defined in `prisma/schema.prisma`. License: GPL-3.0-only (see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
