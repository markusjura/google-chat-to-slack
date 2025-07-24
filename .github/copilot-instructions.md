# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Google Chat to Slack Architecture

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

## Development Guidelines

### Tech Stack

- Node.js with TypeScript
- pnpm for package management
- Zod for configuration validation
- Vitest for testing
- Ultracite (Biome) for linting and formatting

### Code Organization

- **Services Layer**: Core business logic with external API integrations
- **Types Layer**: Comprehensive TypeScript definitions for Google Chat and Slack APIs
- **Utils Layer**: Reusable utilities (logging, progress, rate limiting, caching)
- **CLI Layer**: Command definitions and argument parsing using yargs

### TypeScript Guidelines

- Use interfaces over types
- Follow Declaration Before Use principle
- Avoid enums; use const objects with 'as const'
- Explicit return types for all functions
- Avoid try/catch blocks unless necessary for error translation

### Testing Strategy

**Architecture: CLI Command-Level End-to-End Testing**
- Test at the CLI command level for comprehensive coverage that matches real user workflows
- Mock external services only (Google/Slack APIs), allowing internal service integration to run end-to-end
- Use realistic test scenarios based on actual CLI command combinations

**Test Structure (`src/__tests__/`):**
```
├── commands/          # CLI command integration tests
│   ├── export.test.ts      # export [--space X] [--dry-run]
│   ├── import.test.ts      # import [--channel X] [--dry-run]  
│   ├── transform.test.ts   # transform [--dry-run]
│   ├── login.test.ts       # login google-chat/slack
│   └── logout.test.ts      # logout google-chat/slack
├── utils/             # Complex business logic unit tests
│   ├── rate-limiter.test.ts    # Rate limiting algorithms
│   ├── user-cache.test.ts      # Caching and cleanup logic
│   └── token-manager.test.ts   # OS keyring integration
├── fixtures/          # Realistic mock data
│   ├── google-chat-api.ts  # Mock API responses
│   ├── slack-api.ts        # Mock Slack responses
│   └── file-system.ts      # Mock file operations
└── helpers/
    └── test-utils.ts       # Test utilities
```

**Key Test Scenarios:**
- **Export**: Full export, dry-run, specific space filtering, error handling
- **Transform**: Data conversion, user mapping, attachment processing
- **Import**: Full import, target channel, dry-run connection test
- **Utils**: Rate limiting algorithms, cache management, token operations

**Mocking Strategy:**
- ✅ Mock: External APIs (Google Chat, Slack), file system, HTTP requests, OS keyring
- ❌ Don't Mock: Internal services, data transformation, CLI parsing, business logic

Use `vi.mock` for dependency isolation. Manual CLI testing available via dry-run modes.

## Commands

### Core Migration Workflow

```bash
# Complete migration workflow
pnpm start login google-chat                # Authenticate with Google Chat
pnpm start export --space X                 # Export specific space
pnpm start transform                        # Convert to Slack format
pnpm start login slack                      # Setup Slack bot token
pnpm start import --channel target-channel  # Import to Slack
```

### Development Commands

```bash
# Code quality
pnpm check                                        # Format + lint + typecheck combined

# Testing
pnpm test --run                                   # Run Vitest unit tests
pnpm start export --space competition             # Test full export with minimal data
pnpm start export --dry-run                       # Test export with minimal data
pnpm start transform                              # Test transformation
pnpm start import --dry-run                       # Test Slack API connectivity
```

## Important Implementation Details

### Google Chat Integration

- Uses OAuth2 with Google Directory API for admin-level user access
- Requires domain admin privileges to resolve all user names
- Implements sequential API calls to respect rate limits
- Caches user data to minimize API calls

### Slack Integration

- Uses Bot User OAuth Token (not user tokens)
- Required Slack permissions: `chat:write`, `files:write`, `channels:read`, `channels:manage`
- Rate limiting: 1 message per second per channel to avoid API limits
- Cannot override message timestamps or avatars (Slack API limitation)

### Data Format

- **Export format**: Google Chat API responses with local file paths
- **Import format**: Simplified structure with `display_name` directly in messages
- **User resolution**: Maps Google user IDs to full names via Directory API
- **Attachment handling**: Downloads files locally, then uploads to Slack

### Authentication

- Google Chat: OAuth2 with refresh tokens stored in OS keyring
- Slack: Bot tokens via environment variables or interactive setup
- Automatic token refresh and validation

## Checkpointing

- Use claudepoint MCP server for code checkpointing
- Create checkpoints before major code changes__
- Revert to checkpoints when requested by user

## Browser Testing

- Use Playwright MCP for UI verification when needed