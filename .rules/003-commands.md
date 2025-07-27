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
