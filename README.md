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

On new human-authored messages, the bot replies without pinging the sender, tries to hide the original preview, and displays **one normal-size linked inline-code label** (without Discord's small-text `-#` prefix): `tiktok-<id>.mp4` for TikTok or `twitter-<post-id>`, `facebook-<post-id>`, `instagram-<post-id>`, `reddit-<post-id>`, etc. for other sites. If the URL does not contain a recognizable ID, only the platform name is used. There is no `View original` link or raw URL in the reply. The clickable label targets the external embed service; the bot never uploads an MP4. Discord may not generate a playable preview for masked Markdown links or reliably combine inline-code styling with clickable links, so verify this visually in the live server. Up to three URLs per message are supported. Link fixing defaults to **all channels** independently of emoji reaction channel selections.

## Commands

Only **two top-level slash commands** are registered. Both require **Manage Server** permissions; all settings replies are ephemeral.

### /embed-settings

- /embed-settings preview — turn automatic social link previews on/off, add/remove allowed preview channels, or allow all channels.
- /embed-settings moderation — decide whether messages without recognized media are deleted in a selected channel.
- /embed-settings show — display current preview and channel moderation configuration.

### /reaction-settings

- /reaction-settings server — set like/dislike emojis, bot-post reactions (including WHTBA converted links), and reactions on embedded media; initializes a fresh server if necessary.
- /reaction-settings channel — override the server embed-reaction policy for one channel.
- /reaction-settings channels — open the interactive multi-select picker to add, remove or clear emoji-reaction channels.
- /reaction-settings show — show current server emojis, bot-reaction toggle and selected reaction channels.

**Migration:** The previous /help, /setupserver, /setupchannel, /settings and /select-channels slash commands are retired. Run npm run updatecommands to replace all registered guild commands with only the two new top-level commands. The current deployment starts with a new SQLite database; older PostgreSQL data is not migrated.

No media download, conversion or soundboard components are installed; yt-dlp and FFmpeg are not required.
## Run locally on Windows (no PostgreSQL)

**Requirements:** Node.js 20 or 22, npm, and your existing Discord credentials. SQLite is bundled with Prisma, so **no PostgreSQL, Redis, SQL app or database account is necessary**.

The database will be stored at `D:\\whtba-bot\\prisma\\whtba.db`. This file is created automatically and is ignored by Git.

1. Stop the running bot (Ctrl+C). Open CMD in your existing project folder.
2. Update code and dependencies:

```bat
cd /d D:\\whtba-bot
git pull origin main
npm install
```

3. In `.env`, **keep your three existing Discord values unchanged** and replace only the old PostgreSQL `DATABASE_URL` with:

```dotenv
DATABASE_URL="file:./whtba.db"
```

4. Create a **brand-new SQLite database** and regenerate the Prisma client:

```bat
npx prisma generate
npm run db:setup
```

5. Validate, re-register the two admin slash commands (only needed when changing commands), then start the bot:

```bat
npm run build
npm test
npm run updatecommands
npm start
```

6. In Discord, use `/reaction-settings server` and `/reaction-settings channels` to recreate your emoji preferences; `/embed-settings preview` controls link fixing. Since this is a fresh database, previous reaction counts and channel selections are intentionally **not** imported.

**Backups:** Stop the bot and copy `prisma\\whtba.db` somewhere safe. Never commit, upload or share the database file or `.env`. To reset later, stop the bot, delete *only* `prisma\\whtba.db` and run `npm run db:setup` again. This is destructive to stored data.

**Database path detail:** Prisma resolves `file:./whtba.db` relative to `prisma/schema.prisma`, not the CMD working directory.

**Docker:** The image initializes SQLite on startup at `/app/data/whtba.db`; mount a persistent Docker volume at `/app/data` to retain its data between containers.

**Discord permissions**: View Channel, Read Message History, Send Messages, Embed Links, and Manage Messages (for suppressing the original embed). Enable the Message Content Intent. Attach Files and Create Expressions are not required by these previews.

## Notes

- Media is neither downloaded nor re-encoded. The bot only posts URLs; Discord and external embed providers handle preview generation.
- Proxy uptime and playback support vary, and some videos may only appear as simple links.
- Link fixing uses its own optional channel allowlist, while reaction channels are managed by `/reaction-settings channels`.
- `/reaction-settings server react-to-bots:true` adds reactions to eligible attachments/embeds from **other bots** and to **WHTBA's own converted-link replies**. Other WHTBA messages stay excluded. The toggle defaults to disabled. `/reaction-settings channels` limits these reactions, but link fixing itself remains independent. Human votes on eligible bot posts and WHTBA's converted replies are counted; votes cast by other bots remain ignored.
- SQLite stores server/channel settings and reaction counters in the local prisma/whtba.db file. Old PostgreSQL values are not imported.
- Events are processed only while the bot is running; past missed messages are not retroactively scanned.
- Bot/user/message IDs stored by the original reaction tracking system remain unchanged.

## Development

```sh
npm run build
npm test
```

Project files are organized under `src/`; database models are defined in `prisma/schema.prisma`. License: GPL-3.0-only (see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
