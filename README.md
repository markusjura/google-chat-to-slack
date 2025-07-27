# Google Chat to Slack Migrator

A CLI tool for migrating channels, messages, threads, attachments, and reactions from Google Chat to Slack.

## Features

- **Complete Migration**: Export all channels, messages, threads, attachments, and reactions
- **Selective Migration**: Choose specific spaces/channels to migrate
- **User Mentions**: Preserves user mentions in a message (as text, not creating the users itself)
- **Rate Limited**: Respects both Google Chat and Slack API limits
- **Channel Management**: Rename and organize channels during import
- **Three-Stage Pipeline**: Export → Transform → Import for reliability

## Installation

```bash
npm install -g google-chat-to-slack
```

## Quick Start

```bash
# 1. Authenticate with both services
googletoslack login google-chat
googletoslack login slack

# 2. Run complete migration
googletoslack migrate

# 3. Or run individual steps
googletoslack export
googletoslack transform
googletoslack import
```

## Setup & Configuration

> **Note**: Detailed authentication setup guide coming soon. You'll need:
>
> - Google Chat: OAuth2 credentials with Google Directory API access
> - Slack: Bot token with appropriate permissions

### Google Chat Requirements

- Google Cloud Console project with Chat API enabled
- OAuth2 client credentials
- Domain admin privileges for user resolution

### Slack Requirements

- Slack app with bot token
- Required permissions: `chat:write`, `files:write`, `channels:read`, `channels:manage`

## Commands

### Authentication

```bash
# Login to Google Chat (opens browser for OAuth)
googletoslack login google-chat

# Login to Slack (interactive bot token setup)
googletoslack login slack

# Logout from services
googletoslack logout google-chat
googletoslack logout slack
```

### Migration

```bash
# Complete migration (recommended)
googletoslack migrate

# Migrate specific channels only
googletoslack migrate --channel general --channel team-updates

# Test migration with minimal data
googletoslack migrate --dry-run

# Add prefix to channel names
googletoslack migrate --channel-prefix "gchat-"

# Rename channels during migration
googletoslack migrate --channel-rename "old-name=new-name"
```

### Individual Steps

#### Export

```bash
# Export all Google Chat data
googletoslack export

# Export specific spaces
googletoslack export --channel SPACE_ID

# Test export with minimal data
googletoslack export --dry-run

# Custom output directory
googletoslack export --output /custom/path
```

The export creates:

- `data/export/export.json` - Complete message data
- `data/export/attachments/` - Downloaded files
- `data/export/avatars/` - User profile images

#### Transform

```bash
# Transform exported data for Slack
googletoslack transform

# Test transformation
googletoslack transform --dry-run

# Custom directories
googletoslack transform --input /custom/export --output /custom/import
```

#### Import

```bash
# Import all channels to Slack
googletoslack import

# Import specific channels only
googletoslack import --channel general --channel team-updates

# Test Slack connection
googletoslack import --dry-run

# Add channel prefix
googletoslack import --channel-prefix "gchat-"

# Rename channels
googletoslack import --channel-rename "old-name=new-name"
```

## Rate Limits & Performance

- **Google Chat**: Sequential API calls to respect rate limits
- **Slack**: 1 message per second per channel
- **Large migrations**: May take several hours depending on data volume
- **Progress tracking**: Visual progress bars for all operations

## Data Handling

- **Attachments**: Downloaded locally, then uploaded to Slack
- **User mentions**: Mapped via Google Directory API
- **Timestamps**: Preserved when possible (Slack API limitations apply)
- **Reactions**: Migrated with closest Slack emoji equivalent
- **Threads**: Full thread structure maintained

## Contributing

### Development Setup

```bash
# Clone repository
git clone https://github.com/markusjura/google-chat-to-slack.git
cd google-chat-to-slack

# Install dependencies
pnpm install

# Run in development mode
pnpm start <command>

# Run tests
pnpm test

# Format, lint, and typecheck based on ultracite (biome)
pnpm check
```

### Project Structure

```
src/
├── cli/commands/    # CLI command definitions
├── services/        # Core business logic
├── types/           # TypeScript type definitions
└── utils/           # Utilities (logging, rate limiting, etc.)
```

### Testing

```bash
# Run unit tests
pnpm test --run

# Test with real data (minimal)
pnpm start export --dry-run
pnpm start transform
pnpm start import --dry-run
```

## License

MIT - See [LICENSE](LICENSE) file for details.

## Support

- [Issues](https://github.com/markusjura/google-chat-to-slack/issues) - Bug reports and feature requests
