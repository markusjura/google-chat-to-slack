# Specification

This document outlines the technical specification for a Slack importer script that migrates data from Google Chat to a Slack workspace.

## 1. Core Functionality

The script will perform the following actions:

- **Export Data from Google Chat:** Extract channels (spaces), messages, threads, and attachments from a Google Chat workspace.
- **Import Data to Slack:** Import the exported data into a Slack workspace, preserving the original structure and metadata as closely as possible.
- **Authentication:** Securely authenticate with both Google Chat and Slack APIs.
- **Rate Limiting:** Adhere to the API rate limits of both services to prevent interruptions.
- **CLI Interface:** Provide a command-line interface for executing the migration process.

## 2. Data Migration

### 2.1. Export from Google Chat

- **API:** Google Chat API.
- **Data to Export:**
    - **Spaces:** All spaces the authenticated user is a member of (`spaces.list`). This includes public spaces, private spaces, and direct messages.
    - **Messages:** All messages within each space (`spaces.messages.list`).
    - **Threads:** Replies to messages will be fetched to reconstruct threads.
    - **Attachments:** Media attached to messages will be downloaded (`media.download`).
    - **Users:** User information will be fetched to map authors.
    - **Timestamps:** Message creation and edit timestamps will be preserved.

### 2.2. Import to Slack

- **API:** Slack API.
- **Data to Import:**
    - **Channels:** Google Chat spaces will be mapped to Slack channels. Public spaces become public channels, and private spaces become private channels (`conversations.create`).
    - **Messages:** Messages will be posted to the corresponding channels (`chat.postMessage`).
    - **Threads:** Message replies will be posted as threaded replies in Slack.
    - **Attachments:** Downloaded attachments will be uploaded to Slack. The `files.upload` method is the likely candidate.
    - **Users:** A mapping will be created between Google Chat users and Slack users (e.g., by email address) to attribute messages correctly.
    - **Timestamps:** The original message timestamp will be included in the message body, as Slack's API does not allow setting a custom timestamp for new messages.

## 3. Authentication

- **Google Chat:** OAuth 2.0 with user credentials. The application will request the necessary scopes (e.g., `chat.messages`, `chat.spaces`) to read data on the user's behalf.
- **Slack:** OAuth 2.0. A Slack App will be created to obtain a Client ID and Secret. The script will use a bot token (`xoxb-`) to perform actions like creating channels and posting messages. This is preferable to a user token as it is not tied to a specific user's session.

An abstraction layer will be created to manage tokens for both services, including handling token refresh where applicable.

## 4. Rate Limiting

The script will implement rate-limiting strategies to avoid hitting API limits.

- **Google Chat (Business Standard Plan):**
    - Limits are per-project, not per-plan.
    - Message reads: ~3,000 requests/minute.
    - Attachment downloads: ~3,000 requests/minute.
    - The script will include delays between requests to stay well within these generous limits.

- **Slack (Free Plan):**
    - Message posting (`chat.postMessage`): Limited to approximately 1 message per second per channel.
    - The script will throttle message creation to adhere to this limit, likely introducing a 1-second delay between each message post.
    - The script will handle `429 Too Many Requests` errors gracefully by implementing an exponential backoff and retry mechanism.

## 5. CLI Commands

The migration tool will be structured with the following commands:

- **`login`**:
    - Guides the user through an OAuth 2.0 flow to authorize the tool with Google Chat or Slack.
    - Securely stores the obtained credentials in the system's native keychain.

- **`logout`**:
    - Removes the user's stored credentials for both services from the system keychain.

- **`export`**:
    - Connects to Google Chat using stored credentials.
    - Fetches all data and saves it to a local intermediate format.
    - **`--dry-run` flag:** Tests the connection to the Google Chat API, fetches a single space with a few messages, and verifies the.
- **`import`**:
    - Reads the intermediate data files.
    - Connects to Slack using stored credentials.
    - Imports the data into the target Slack workspace.
    - **`--dry-run` flag:** Tests the connection to the Slack API, creates a test channel, posts a single message with an attachment, and then cleans up the created channel and message.

- **`migrate`**:
    - An aggregate command that executes the `export` and `import` commands in sequence for a seamless end-to-end migration.
    - Will accept all arguments from both `export` and `import` commands.

## 6. Intermediate Export Format

To facilitate a clean import process and allow for inspection, the exported data will be stored in a structured JSON format. The export process will generate a primary JSON file (`migration-data.json`) and a directory for downloaded attachments.

### 6.1. File Structure

```
/export_data/
├── /attachments/
│   ├── attachment_1.png
│   └── attachment_2.pdf
└── migration-data.json
```

### 6.2. `migration-data.json` Specification

The main JSON file will have a root object containing arrays of users and spaces.

-   **`users`**: An array of all unique users encountered during the export. This is crucial for mapping message authors to Slack users.
-   **`spaces`**: An array of all Google Chat spaces (channels) to be migrated. Each space object contains its messages.

### 6.3. Object Schemas and Example

Below is an example demonstrating the structure of the `migration-data.json` file.

```json
{
  "export_timestamp": "2025-07-12T10:00:00Z",
  "users": [
    {
      "name": "users/123456789012345678901",
      "displayName": "Alice",
      "email": "alice@example.com",
      "type": "HUMAN"
    },
    {
      "name": "users/987654321098765432109",
      "displayName": "Bob",
      "email": "bob@example.com",
      "type": "HUMAN"
    }
  ],
  "spaces": [
    {
      "name": "spaces/AAAAAAAAAAA",
      "displayName": "Project Phoenix",
      "spaceType": "SPACE",
      "messages": [
        {
          "name": "spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.BBBBBBBBBBB",
          "creator": "users/123456789012345678901",
          "createTime": "2025-07-10T14:30:00Z",
          "text": "Hey everyone, let's kick off the project.",
          "thread": null,
          "attachments": []
        },
        {
          "name": "spaces/AAAAAAAAAAA/messages/CCCCCCCCCCC.CCCCCCCCCCC",
          "creator": "users/987654321098765432109",
          "createTime": "2025-07-10T14:35:00Z",
          "text": "Great! Here is the initial design document.",
          "thread": {
            "name": "spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.BBBBBBBBBBB"
          },
          "attachments": [
            {
              "name": "spaces/AAAAAAAAAAA/messages/CCCCCCCCCCC.CCCCCCCCCCC/attachments/DDDDDDDDDDD",
              "contentType": "application/pdf",
              "downloadUrl": "https://chat.googleapis.com/v1/media/...",
              "localPath": "attachments/design_doc.pdf"
            }
          ]
        }
      ]
    }
  ]
}
```

## 7. Testing

To ensure the reliability and correctness of the migration script, the following testing strategy will be implemented, adhering to project standards:

-   **Unit Tests:** Focused unit tests will be written for critical business logic and utility functions. This includes:
    -   Data transformation logic (e.g., mapping Google Chat objects to the intermediate format).
    -   Client service logic for interacting with Google Chat and Slack APIs.
    -   **Dependency Isolation:** Dependencies, such as the Google Chat and Slack API clients, will be mocked using `vi.mock` to isolate units of code and ensure tests are fast and reliable.
    -   **Structure:** Tests will be clearly structured using `describe`, `it`, and `expect`. Setup and teardown logic will be handled with `beforeEach` and `afterEach` where necessary.

-   **End-to-End Tests:** The primary CLI commands (`export`, `import`, `migrate`) will be tested end-to-end. These tests will cover the "happy path" and critical edge cases to verify the entire workflow. This will involve running the script against mock data and asserting the output is as expected.

## 8. Authentication

- **Mechanism:** The `login` command will use the OAuth 2.0 Authorization Code Flow with PKCE. This is a security best practice for CLI applications.
- **Credential Storage:** All tokens will be securely stored in the user's native OS credential manager (i.e., macOS Keychain, Windows Credential Manager, or Linux Secret Service). A library like `@napi-rs/keyring` will be used to handle this in a cross-platform way.
- **Google Chat:** OAuth 2.0 with user credentials. The application will request the necessary scopes (e.g., `chat.messages`, `chat.spaces`) to read data on the user's behalf.
- **Slack:** OAuth 2.0. A Slack App will be created to obtain a Client ID and Secret. The script will use a bot token (`xoxb-`) to perform actions like creating channels and posting messages.

## 9. Project Structure

The project will adhere to the following file structure, which is designed for clarity, maintainability, and alignment with project standards.

```
.
├── bin/
│   └── chatmig.ts              # Main CLI entry point
├── src/
│   ├── __tests__/              # Vitest unit and integration tests
│   │   ├── services/
│   │   │   ├── google-chat.test.ts
│   │   │   └── slack.test.ts
│   │   └── commands/
│   │       └── login.test.ts
│   ├── cli/
│   │   ├── commands/           # Command implementations
│   │   │   ├── login.ts
│   │   │   ├── logout.ts
│   │   │   ├── export.ts
│   │   │   ├── import.ts
│   │   │   └── migrate.ts
│   │   └─��� parser.ts           # Argument parsing logic (e.g., using yargs)
│   ├── config/
│   │   └── index.ts            # Manages retrieval of credentials
│   ├── services/               # API clients and core logic
│   │   ├── google-chat.ts      # Google Chat API client
│   │   ├── slack.ts            # Slack API client
│   │   └── migration.ts        # Orchestrates the migration process
│   ├── types/
│   │   ├── google-chat.ts      # Types for Google Chat API
│   │   ├── slack.ts            # Types for Slack API
│   │   └── migration.ts        # Types for the intermediate data format
│   └── utils/
│       ├── logger.ts           # Centralized logging utility
│       └── token-manager.ts    # Secure token storage using system keychain
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

# Implementation Plan

This plan breaks the project into three main phases. For each step, implement the required functionality and then verify it with unit and manual tests to ensure correctness before proceeding.

## Phase 1: Google Chat Export Functionality

**Objective:** Build the commands and logic to export chat history from Google Chat into the specified intermediate JSON format.

1.  **Setup `google-chat` Command Group**
    *   **Action:** Create the base command `chatmig google-chat` which will serve as a namespace for all Google Chat related subcommands.
    *   **Verification:** Run `ts-node bin/chatmig.ts google-chat --help` and confirm the command is registered.

2.  **Implement `google-chat login` and `logout`**
    *   **Action:** Implement the `login` command to handle the Google Chat OAuth 2.0 flow. Securely store the refresh token using the system keychain. Implement the `logout` command to revoke the token and clear credentials.
    *   **Verification:** Write unit tests to mock the OAuth flow and token storage. Manually run `login` and `logout` to confirm the authentication process works and credentials are deleted.

3.  **Implement `google-chat export` Command**
    *   **Action:** Create the `export` command structure, accepting `--space` and `--output` arguments.
    *   **Verification:** Run the `export` command with `--help` to ensure arguments are correctly defined.

4.  **Implement Data Fetching Logic**
    *   **Action:** Implement the service logic to list a user's spaces and fetch all messages for a given space, including handling API pagination.
    *   **Verification:** Write unit tests mocking the Google Chat API to verify that spaces are listed and that messages are fetched completely.

5.  **Implement Data Transformation**
    *   **Action:** Create the data transformation logic that converts Google Chat API responses (for spaces, messages, users) into the defined intermediate JSON format.
    *   **Verification:** Write focused unit tests to validate the transformation for different message types (e.g., text, attachments, threads).

6.  **Finalize Export and Test End-to-End**
    *   **Action:** Connect the data fetching and transformation steps to the `export` command, writing the final JSON to the specified output file.
    *   **Verification:** Perform a manual end-to-end test by running `chatmig google-chat export --space <test-space-id> --output /tmp/export.json`. Inspect the JSON file to confirm its structure and content are correct.

## Phase 2: Slack Import Functionality

**Objective:** Build the commands and logic to import data from the intermediate JSON format into a Slack workspace.

1.  **Setup `slack` Command Group**
    *   **Action:** Create the base command `chatmig slack` for all Slack-related subcommands.
    *   **Verification:** Run `ts-node bin/chatmig.ts slack --help` and confirm the command is registered.

2.  **Enhance `login` and `logout` for Slack**
    *   **Action:** Extend the existing `login` and `logout` commands to also manage Slack API credentials (bot token).
    *   **Verification:** Update unit tests for `login`/`logout` to cover Slack credential management.

3.  **Implement `slack import` Command**
    *   **Action:** Create the `import` command, accepting `--input` and `--channel` arguments.
    *   **Verification:** Run `import --help` to ensure arguments are correctly defined.

4.  **Implement Import Logic**
    *   **Action:** Implement the service logic to:
        1.  Read and parse the intermediate JSON data file.
        2.  Map Google Chat users to Slack users (e.g., by email).
        3.  Find or create the target Slack channel.
        4.  Post messages to the channel, respecting Slack's rate limits.
    *   **Verification:** Write unit tests for the user mapping and data parsing logic. Use mocked Slack API clients to test channel lookup and message posting.

5.  **Test End-to-End Import**
    *   **Action:** Connect the import logic to the `import` command.
    *   **Verification:** Perform a manual end-to-end test by running `chatmig slack import --input /tmp/export.json --channel <test-channel-name>`. Check the target Slack channel to confirm messages and attachments were imported correctly.

## Phase 3: Combined Migration Command

**Objective:** Create a single, seamless command to orchestrate the entire migration from Google Chat to Slack.

1.  **Implement `migrate` Command**
    *   **Action:** Create the top-level `migrate` command that accepts arguments for both the source Google Chat space and the target Slack channel.
    *   **Verification:** Run `migrate --help` to ensure all arguments are correctly defined.

2.  **Implement Migration Orchestration**
    *   **Action:** Implement the orchestration logic that reuses the services from Phase 1 and 2. The data should be passed in-memory from the export function to the import function without writing to a temporary file.
    *   **Verification:** Write unit tests for the orchestration logic, mocking the underlying Google Chat and Slack services.

3.  **Add User Feedback**
    *   **Action:** Enhance the command to provide real-time feedback, such as a progress bar and a final summary report.
    *   **Verification:** Manually run the command and confirm that progress is displayed and a summary is printed upon completion.

4.  **Final End-to-End Test**
    *   **Action:** Perform a full, end-to-end test of the `migrate` command.
    *   **Verification:** Run `chatmig migrate --google-space <test-space-id> --slack-channel <test-channel-name>` and verify that the entire chat history is successfully migrated from the source space to the target channel.