# WHTBA Bot

WHTBA is a self-hosted Discord bot designed for a single server. It provides automatic social media link previews, customizable emoji reactions, channel-specific settings, and local data storage.

## Features

### Social Media Embeds

WHTBA automatically detects supported social media URLs and replies with an alternative link designed to improve Discord's media previews.

Supported platforms:

| Platform | Link provider |
|---|---|
| X / Twitter | fxtwitter.com |
| Reddit | vxreddit.com |
| TikTok | tnktok.com |
| Instagram | eeinstagram.com |
| Bluesky | bskye.app |
| Twitch | fxtwitch.seria.moe |
| Facebook | facebed.seria.moe |
| YouTube Shorts | Native YouTube player |
| Vimeo | Native URL |
| Streamable | Native URL |
| Dailymotion | Native URL |

**Embed behavior:**

- Automatically detects up to three supported links per message.
- Generates compact labels using the platform name and post identifier.
- Uses inline-code styling for link labels.
- Attempts to suppress the original Discord embed.
- Does not mention the original message author.
- Supports channel-specific preview permissions.
- Does not download, upload, or re-encode media.

Example labels:

- `twitter-1234567890`
- `instagram-Cx12Ab3`
- `tiktok-7689983778025901343.mp4`
- `reddit-abcd12`

Media previews are handled by Discord and external services. Playback availability may vary depending on the provider and Discord's link rendering behavior.

### Emoji Reactions

WHTBA can automatically add customizable like and dislike reactions to qualifying messages.

Features include:

- Customizable like and dislike emojis.
- Support for Unicode and server-specific emojis.
- Reactions on supported media attachments and embeds.
- Optional reactions on messages from other bots.
- Automatic reactions on WHTBA's own converted-link replies in configured reaction channels, independently of the other-bot toggle.
- Server-wide and channel-specific embed reaction rules.
- Multiple reaction channels managed through an interactive selector.
- Reaction tracking and persistent statistics.

Emoji reactions and link previews use independent channel configurations.

### Local Database

WHTBA uses SQLite through Prisma.

All application data is stored locally in a single database file:

`prisma/whtba.db`

This includes server settings, channel configurations, user records, and reaction statistics.

SQLite runs directly within the application. No external database server or database management software is required.

## Requirements

- Node.js 20 or 22
- npm
- Git
- A Discord application and bot token
- A Discord server with administrator access for initial configuration

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/stdoggo/whtba-bot.git
cd whtba-bot
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure environment variables

Create a `.env` file in the project root.

You can use `.env.example` as a template.

```dotenv
DISCORD_BOT_TOKEN="YOUR_BOT_TOKEN"
DISCORD_APPLICATION_ID="YOUR_APPLICATION_ID"
DISCORD_GUILD_ID="YOUR_SERVER_ID"
DATABASE_URL="file:./whtba.db"
```

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Discord bot authentication token |
| `DISCORD_APPLICATION_ID` | Discord application ID |
| `DISCORD_GUILD_ID` | ID of the Discord server where the bot operates |
| `DATABASE_URL` | Local SQLite database connection |

Keep your bot token private. Never commit the `.env` file.

### 4. Initialize the database

Generate the Prisma Client:

```bash
npx prisma generate
```

Create the SQLite database and required tables:

```bash
npm run db:setup
```

The database will be created at `prisma/whtba.db`.

### 5. Register Discord commands

```bash
npm run updatecommands
```

This registers the bot's slash commands in the configured Discord server.

### 6. Start the bot

```bash
npm start
```

The bot compiles its TypeScript source and connects to Discord.

Keep the process running for the bot to remain online.

## Discord Commands

WHTBA provides two top-level slash commands. Both require the **Manage Server** permission.

Configuration responses are visible only to the administrator executing the command.

### `/embed-settings`

Controls automatic link previews and channel media rules.

| Subcommand | Description |
|---|---|
| `preview` | Configure link previews and allowed channels |
| `moderation` | Configure media requirements for messages in a channel |
| `show` | Display the current embed configuration |

**Preview settings**

The `preview` subcommand supports:

- `show` — display current settings.
- `enabled` — enable or disable automatic link previews.
- `channel-add` — add a channel to the preview allowlist.
- `channel-remove` — remove a channel from the allowlist.
- `channel-all` — allow previews in every channel.

**Moderation settings**

The `moderation` subcommand controls whether a channel allows ordinary text messages or requires recognized media content.

### `/reaction-settings`

Controls emoji reactions and their channel permissions.

| Subcommand | Description |
|---|---|
| `server` | Configure emojis and server-wide reaction behavior |
| `channel` | Configure embed reaction rules for a channel |
| `channels` | Select where automatic emoji reactions are added |
| `show` | Display the current reaction configuration |

**Server settings**

Configure:

- Like reaction emoji.
- Dislike reaction emoji.
- Optional reactions on messages from other bots. WHTBA's own converted-link replies react automatically in selected channels.
- Reaction rules for embedded content.

**Channel selection**

The `channels` subcommand opens an interactive Discord channel selector.

Administrators can add channels, remove channels, or clear all selected channels. The selector supports batches of up to 25 channels.

By default, reaction channel filtering is unrestricted until a selection is configured. An explicitly empty selection disables automatic reactions.

## Discord Permissions

The bot requires appropriate permissions in the configured server.

Recommended permissions:

- View Channels
- Read Message History
- Send Messages
- Embed Links
- Add Reactions
- Manage Messages

The **Manage Messages** permission is used to suppress original link embeds and for configured message moderation.

Enable the following privileged intent in the Discord Developer Portal:

**Bot → Privileged Gateway Intents → Message Content Intent**

The bot also uses guild, message, and message reaction gateway intents.

## Database Management

### Backup

Stop the bot before copying the SQLite database.

Back up the following file:

`prisma/whtba.db`

Store the backup in a safe location.

### Restore

Stop the bot and replace `prisma/whtba.db` with a valid backup created using a compatible database schema.

Start the bot normally afterward.

### Database initialization

```bash
npm run db:setup
```

This synchronizes the local database schema with the Prisma schema.

### Database inspection

```bash
npx prisma studio
```

Prisma Studio provides an interface for inspecting database records.

Do not expose the local database or its contents publicly.

## Development

Project structure:

```text
whtba-bot/
├── prisma/
│   └── schema.prisma
├── scripts/
│   └── sqlite-smoke.cjs
├── src/
│   ├── commands/
│   ├── handlers/
│   ├── media/
│   ├── queries/
│   ├── scripts/
│   ├── settings/
│   └── entry.ts
├── tests/
├── .env.example
├── package.json
└── tsconfig.json
```

### Build

```bash
npm run build
```

### Run tests

```bash
npm test
```

### Generate Prisma Client

```bash
npx prisma generate
```

### Register slash commands

```bash
npm run updatecommands
```

### Start the application

```bash
npm start
```

## Deployment

WHTBA can run on a Windows or Linux machine that supports the required Node.js and Prisma versions.

The bot requires an active internet connection to communicate with Discord and the external embed providers.

For continuous operation, the Node.js process must remain running. A process manager or operating-system service can be used to restart the bot when necessary.

When using Docker, store the SQLite database in a persistent volume to prevent data loss when containers are recreated.

## Security

- Never share or commit your Discord bot token.
- Keep `.env` and SQLite database files private.
- Use a dedicated Discord bot account.
- Grant only the Discord permissions needed by your configuration.
- Back up the database regularly.
- Keep dependencies updated and review changes before deployment.

## License

Licensed under **GPL-3.0-only**.

See `LICENSE` for details.
