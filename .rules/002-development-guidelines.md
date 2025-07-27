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

- Write concise, technical TypeScript code with accurate examples
- Use functional and declarative programming patterns; avoid classes
- Prefer iteration and modularization over code duplication
- Use descriptive variable names with auxiliary verbs (e.g., isLoading, hasError)
- Follow Declaration Before Use principle
- Avoid enums; use const objects with 'as const'
- Explicit return types for all functions
- Avoid try/catch blocks unless necessary for error translation
- Be concise and to the point

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
