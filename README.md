> **This bot is built for a single private Discord server. It is not a public bot service and has no public invite link.**

# WHTBA bot

A Discord bot that adds like and dislike reactions to shared attachments and supported link previews. Server administrators can customize reaction emojis and configure media rules for individual channels.

## Features

- Automatic 👍 and 👎 reactions on messages containing attachments.
- Configurable reactions for link previews, including images and playable videos.
- Custom server-wide reaction emojis.
- Channel-specific embed settings and optional media-only moderation.
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

### `/setupchannel`

Updates settings for the channel where the command is run.

- `forbid-text` — Allows all messages or deletes messages without qualifying content. Text messages are allowed by default.
- `allow-embed-reactions` — Inherits the server setting or overrides it for the current channel.

Disabling embed reactions does not disable attachment reactions. Use Discord channel permissions to control which channels the bot can access. Reaction emojis are configured at the server level, not per channel.

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
- `src/handlers/` — Message and reaction processing.
- `src/queries/` — Database operations and identifier conversion.
- `src/scripts/register-commands.ts` — Guild-scoped command registration.
- `prisma/schema.prisma` — Database schema.
- `tests/` — Regression tests.

## License

Licensed under [GPL-3.0-only](LICENSE). Source attribution and modification notices are available in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
