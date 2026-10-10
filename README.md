> **This bot is built for a single private Discord server. It is not a public bot service and has no public invite link.**

# WHTBA bot

A Discord bot that adds like and dislike reactions to shared attachments and supported link previews. Server administrators can customize reaction emojis and configure media rules for individual channels.

## Features

- Automatic 👍 and 👎 reactions on messages containing attachments.
- Configurable reactions for link previews, including images and playable videos.
- Custom server-wide reaction emojis.
- Channel-specific embed settings and optional media-only moderation.
- Multi-select reaction channel management via `/select-channels`.
- Automatic X/Twitter, Reddit and TikTok embed fixing in **all channels**, independent of reaction selections.
- Persistent settings and message reaction counters in PostgreSQL.
- Event handling and slash command registration scoped to one configured server.

## Documentation

See the [installation guide](INSTALLATION.md) for prerequisites, Discord application configuration, environment variables, database setup, deployment, and troubleshooting.

## Commands

All commands require the **Manage Server** permission and are available in the configured server.

### `/help`

Displays a short usage guide and configuration examples.

### `/setupserver`

Registers the server or updates its settings.

- `like-reaction` — Sets the like emoji. Default: 👍.
- `dislike-reaction` — Sets the dislike emoji. Default: 👎.
- `allow-embed-reactions` — Controls which link previews receive reactions: none, all previews, playable video previews, or previews containing an image/video.

Link preview reactions are disabled by default. Attachment reactions remain enabled. Custom emojis must belong to the configured server.

### `/select-channels`

Run this slash command to choose where the bot automatically adds like/dislike reactions. Use the first channel picker to **add up to 25 channels at once**, the second picker to remove channels, and the clear button to save an empty selection (disabling reactions everywhere). Run the command or use the picker again to add more than 25 channels.

The selection persists in the existing `ServerSettings` JSON column; no migration is required. Before the first explicit selection, existing servers retain their previous behavior of reacting in all channels.

### `/setupchannel`

Updates settings for the channel where the command is run.

- `forbid-text` — Allows all messages or deletes messages without qualifying content. Text messages are allowed by default.
- `allow-embed-reactions` — Inherits the server setting or overrides it for the current channel.

Disabling embed reactions does not disable attachment reactions. Use `/select-channels` to restrict the channels receiving reactions. Discord permissions still control what the bot can access. Reaction emojis are configured at the server level, not per channel.

## Social link previews (all channels)

For messages containing X/Twitter, Reddit or TikTok links, the bot replies to the original message **without pinging** its author and suppresses the embed on the original message.

- `x.com` / `twitter.com` are converted to `fxtwitter.com`.
- `reddit.com` (including www/old/new/mobile) is converted to `vxreddit.com`.
- TikTok links are handled as an MP4 upload where the TikWM public service supplies a video smaller than 8 MiB. Otherwise, the bot falls back to the direct media embed service `d.tnktok.com`. TikTok slideshows use the fallback.
- Each fixed reply includes a clickable **View original** link pointing to the actual submitted URL.
- Source links and fixed links use Discord's smaller `-#` subtext syntax, while the fixed URL remains available for embed previews.
- Up to three recognized links in a single message are processed in one reply; MP4 upload is only attempted for a single TikTok URL.
- These replies operate in every channel in the configured private server, **regardless of `/select-channels`**, even before running `/setupserver`. Source messages with recognized links are not passed to the emoji-reaction/media-only handler.

**Permissions:** The bot needs View Channel, Send Messages, Embed Links, Read Message History and **Manage Messages** to suppress the original preview. Attach Files is required for native TikTok MP4 uploads. Enable Message Content Intent in the Discord Developer Portal. If the original preview remains visible, check Manage Messages.

The MP4 downloader is best-effort and requires the third-party TikWM service; fallback previews require `d.tnktok.com` to be available. Both services are independent of this project's database, and requests to these services disclose the shared link to them. The bot does not cache videos.

## Behavior

The bot listens for new messages and reaction additions/removals. It adds its two initial reactions to qualifying messages and stores reaction counters. Messages and reactions from bot accounts are ignored.

Attachments are not restricted to image and video MIME types. When a link preview has not loaded yet, the bot may briefly wait and fetch the message again before processing it.

Only events from the server specified by `DISCORD_GUILD_ID` are processed. Commands are registered for that server rather than globally.

## Data storage

PostgreSQL stores server and channel settings, user and message identifiers, last-known names, attachment/embed metadata, and reaction counters. Media files themselves are not downloaded or backed up.

Discord identifiers remain strings in application code and are converted to `bigint` at the database boundary. JSON settings and content retain their original JSON-compatible values. Caching is in memory; a separate Redis service is not required.

The server operator is responsible for database access, retention, and backups. There is no automatic data cleanup command.

## Limitations

- No user reputation totals, leaderboards, or reward system.
- No historical message scan or persistent catch-up mechanism for events missed while offline.
- No special reaction for restoring the bot's initial emojis.
- Reaction counters can include the bot's own initial reactions.
- Previously rounded identifiers cannot be recovered automatically.

## Development

The project uses TypeScript, discord.js, Prisma, and PostgreSQL.

```sh
npm run build
npm test
```

The regression suite covers identifier precision, database query conversions, private-server event routing, and the removed refresh-reaction behavior. Tests do not connect to live Discord or PostgreSQL services.

### Project structure

- `src/entry.ts` — Bot initialization and event routing.
- `src/private-server.ts` — Private server configuration.
- `src/commands/` — Slash command definitions and handlers.
- `src/handlers/` — Message/reaction processing and independent social-link previews.
- `src/settings/reaction-channels.ts` — Reaction channel filtering and selection logic.
- `src/queries/` — Database operations and identifier conversion.
- `src/scripts/register-commands.ts` — Guild-scoped command registration.
- `prisma/schema.prisma` — Database schema.
- `tests/` — Regression tests.

## License

Licensed under [GPL-3.0-only](LICENSE). Source attribution and modification notices are available in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
