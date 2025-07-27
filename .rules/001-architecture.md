## Google Chat to Slack Architecture

This is a Node.js CLI tool that migrates channels, messages, and threads from Google Chat to Slack using a three-stage pipeline: **Export → Transform → Import**.

## High-Level Architecture

The application follows a service-oriented architecture with clear separation of concerns:

### Core Pipeline Services

1. **Google Chat Service** (`src/services/google-chat.ts`) - Exports data from Google Chat using OAuth2 and Google APIs
2. **Transformation Service** (`src/services/transformation.ts`) - Converts Google Chat data to Slack-compatible format
3. **Slack Service** (`src/services/slack.ts`) - Imports transformed data into Slack using bot tokens

### Data Flow Architecture

```
Google Chat API → Export Service → data/export/export.json
                                       ↓
Transform Service → data/import/import.json → Import Service → Slack API
```

### Key Architectural Patterns

- **Rate Limiting**: All API calls use custom rate limiters (`src/utils/rate-limiter.ts`)
- **User Resolution**: Google Directory API integration for admin-level user access (requires domain admin privileges)
- **Attachment Handling**: Downloads and re-uploads files through both platforms
- **Authentication Management**: Secure token storage using OS keyring (`src/utils/token-manager.ts`)
- **Progress Tracking**: Visual progress bars for long-running operations (`src/utils/progress-bar.ts`)
- **Comprehensive Logging**: Detailed logging with issue categorization (`src/utils/logger.ts`)

### CLI Command Structure

Each command is implemented as a separate module in `src/cli/commands/`:

- **login/logout**: OAuth2 flow management
- **export**: Google Chat data extraction with attachment downloads
- **transform**: Data format conversion and user mapping
- **import**: Slack channel/message creation with rate limiting
