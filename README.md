# Chat Migrator

This node script `chatmig` is migrating channels, messages, and threads from Google Chat to Slack.

## Installation

To install the dependencies, run:

```bash
pnpm install
```

## Usage

To run the CLI commands, use `pnpm start <command> <service>`.

### Login

To log in to a chat service (e.g., Google Chat):

```bash
pnpm start login google-chat
```

### Logout

To log out from a chat service (e.g., Google Chat):

```bash
pnpm start logout google-chat
```

### Export

To export data from a chat service (e.g., Google Chat):

```bash
# Export all spaces and messages to data/export/
pnpm start export google-chat

# Export a specific space
pnpm start export google-chat --space SPACE_ID

# Test the export process with dry-run (1 message, 1 space)
pnpm start export google-chat --dry-run

# Specify custom output directory (default: data/export)
pnpm start export google-chat --output /custom/path
```

The export command will:
- Download all messages, attachments, and user avatars to `data/export/`
- Create a clean directory structure with `attachments/` and `avatars/` subdirectories
- Generate an `export.json` file with complete message data and local file paths
- Use `--dry-run` to test API connectivity and verify the process with minimal data
- Replace existing export directory on each run for a clean slate

### Transform

To transform exported Google Chat data to Slack import format:

```bash
# Transform data/export/ to data/import/
pnpm start transform

# Test transformation without writing files
pnpm start transform --dry-run

# Specify custom input/output directories
pnpm start transform --input /custom/export --output /custom/import
```

The transform command will:
- Read from `data/export/` by default
- Transform Google Chat data to Slack 2025 API format
- Write to `data/import/` (replaces existing directory)
- Copy all attachments and avatars to the import directory
- Generate user mappings and channel name normalization