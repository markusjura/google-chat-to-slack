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
# Export all spaces and messages
pnpm start export google-chat

# Export a specific space
pnpm start export google-chat --space SPACE_ID

# Test the export process with dry-run (1 message, 1 space)
pnpm start export google-chat --dry-run

# Specify custom output directory
pnpm start export google-chat --output /path/to/export
```

The export command will:
- Download all messages, attachments, and user avatars
- Create a directory structure with `attachments/` and `avatars/` subdirectories
- Generate an `export.json` file with complete message data and local file paths
- Use `--dry-run` to test API connectivity and verify the process with minimal data