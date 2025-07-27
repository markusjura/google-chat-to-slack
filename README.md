# Google Chat to Slack Migrator

[![npm version](https://badge.fury.io/js/google-chat-to-slack.svg)](https://www.npmjs.com/package/google-chat-to-slack)
[![npm downloads](https://img.shields.io/npm/dm/google-chat-to-slack.svg)](https://www.npmjs.com/package/google-chat-to-slack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
googletoslack login google
googletoslack login slack

# 2. Run complete migration
googletoslack migrate

# 3. Or run individual steps
googletoslack export
googletoslack transform
googletoslack import
```

## Setup & Configuration

### Quick Reference

**Google Chat Requirements:**

- Google Workspace admin access
- APIs:
  - Google Chat
  - Admin SDK Directory
  - Google Drive
- OAuth2 scopes:
  - `chat.spaces.readonly`
  - `chat.messages.readonly`
  - `drive.readonly`
  - `admin.directory.user.readonly`
- Environment variables:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`

**Slack Requirements:**

- Slack workspace admin access
- Bot token scopes:
  - `chat:write`
  - `files:write`
  - `channels:read`
  - `channels:manage`
  - `reactions:write`
- Environment variables:
  - `SLACK_BOT_TOKEN`

### Detailed Setup Guide

#### Google Cloud Console Setup

1. **Enable Required APIs** in your Google Cloud project:
   - [Google Chat API](https://console.cloud.google.com/apis/library/chat.googleapis.com)
   - [Admin SDK Directory API](https://console.cloud.google.com/apis/library/admin.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)

2. **Configure OAuth Consent Screen:**
   - Go to [APIs & Services > OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
   - Select user type: "Internal" (for Google Workspace orgs) or "External" (for personal use)
   - In [Branding](https://console.cloud.google.com/auth/branding), fill in app name, user support email, and developer contact information

3. **Add Required OAuth Scopes:**
   - Go to [APIs & Services > Data Access](https://console.cloud.google.com/auth/scopes)
   - Click "Add or remove scopes"
   - Add these scopes (they must match the ones in Quick Reference above):
     - `https://www.googleapis.com/auth/chat.spaces.readonly`
     - `https://www.googleapis.com/auth/chat.messages.readonly`
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/admin.directory.user.readonly`
   - Click "Update" to save the scopes

4. **Create OAuth2 Client:**
   - Go to [APIs & Services > Clients](https://console.cloud.google.com/auth/clients)
   - Click "Create OAuth client ID"
   - Select "Desktop application" (for CLI tools)
   - Enter a name for your OAuth client
   - Click "Create" to get your `client_id` and `client_secret`
   - Copy both values for environment variable setup

#### Slack App Setup

1. **Create Slack App**:
   - Go to [Your Apps](https://api.slack.com/apps) → "Create New App" → "From scratch"
   - Enter app name and select your workspace

2. **Configure Bot Token Scopes**:
   - Go to "OAuth & Permissions" in sidebar
   - Under `Scopes > Bot Token Scopes`, add these [scopes](https://api.slack.com/scopes):
     - `channels:manage` (Create channels)
     - `channels:read` (View channels)
     - `chat:write` (Send messages)
     - `files:write` (Upload files)
     - `reactions:write` (Add emoji reactions)

3. **Install App**:
   - Click "Install to Workspace" at the top
   - Review permissions and click "Allow"

4. **Get Bot User OAuth Token**:
   - Go to "OAuth & Permissions" in sidebar
   - Copy the `OAuth Tokens > Bot User OAuth Token` for environment variable setup (starts with `xoxb-`)

#### Environment Variables Setup

For global npm package usage, set environment variables using one of these methods:

**Option 1: Environment variables (temporary)**

```bash
export GOOGLE_CLIENT_ID="your_google_client_id"
export GOOGLE_CLIENT_SECRET="your_google_client_secret"
export SLACK_BOT_TOKEN="xoxb-your-slack-bot-token"
```

**Option 2: Config file (persistent)**

Create a config file in the `~/.config/googletoslack` directory:

```bash
mkdir -p ~/.config/googletoslack
cat > ~/.config/googletoslack/config << EOF
GOOGLE_CLIENT_ID="your_google_client_id"
GOOGLE_CLIENT_SECRET="your_google_client_secret"
SLACK_BOT_TOKEN="xoxb-your-slack-bot-token"
EOF
```

**Verify Setup:**

```bash
echo $GOOGLE_CLIENT_ID
echo $SLACK_BOT_TOKEN
googletoslack login google  # Test Google authentication
googletoslack login slack   # Test Slack authentication
```

## Commands

### Authentication

```bash
# Login to Google (opens browser for OAuth)
googletoslack login google

# Login to Slack (interactive bot token setup)
googletoslack login slack

# Logout from services
googletoslack logout google
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

- `~/.config/googletoslack/data/export/export.json` - Complete message data
- `~/.config/googletoslack/data/export/attachments/` - Downloaded files
- `~/.config/googletoslack/data/export/avatars/` - User profile images

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

- **Attachments**: Downloaded to `~/.config/googletoslack/data/`, then uploaded to Slack
- **User mentions**: Mapped via Google Directory API
- **Timestamps**: Preserved when possible (Slack API limitations apply)
- **Reactions**: Migrated with closest Slack emoji equivalent
- **Threads**: Full thread structure maintained
- **Data location**: All migration data stored in `~/.config/googletoslack/data/` (export and import directories)

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

### Publishing

This package is published to [npmjs.com](https://www.npmjs.com/package/google-chat-to-slack) with automated releases.

#### Creating a Release

1. Update version and create git tag:

   ```bash
   npm version patch
   ```

2. Push the tag to trigger automated publishing:

   ```bash
   git push --tags
   ```

The GitHub Actions workflow will automatically build, test, and publish to npm.

## License

MIT - See [LICENSE](LICENSE) file for details.
