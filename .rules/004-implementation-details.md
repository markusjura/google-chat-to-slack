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
