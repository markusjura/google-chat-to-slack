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
pnpm start export google-chat
```