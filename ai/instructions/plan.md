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
  - **User Avatars:** Profile pictures will be downloaded from the Google People API for all message authors.
  - **Users:** User information will be fetched to map authors, including display names and email addresses.
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

- **Google Chat:** OAuth 2.0 with user credentials. The application will request the necessary scopes including `chat.spaces.readonly`, `chat.messages.readonly`, `chat.memberships.readonly`, `profile`, and `email` to read chat data and user profile information.
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
  - Connects to a source service (e.g., Google Chat) using stored credentials.
  - Fetches all data (spaces, messages, users, etc.) including attachments and user avatars.
  - Saves the data to a local directory structure with downloaded files and JSON metadata.
  - **`--dry-run` flag:** Uses the same implementation logic but limits scope (1 message per space, 1 space max) to quickly test API connectivity and verify the full export process without downloading excessive data.

- **`transform`**:
    - Reads the exported source data file.
    - Transforms it into the target format required by the destination service (e.g., Slack).
    - Saves the transformed data to a new intermediate file.
    - **`--dry-run` flag:** Performs the transformation and prints statistics about the transformed data without writing to a file.

- **`import`**:
  - Reads the **transformed** intermediate data files.
  - Connects to the destination service (e.g., Slack) using stored credentials.
  - Imports the data into the target workspace.
  - **`--dry-run` flag:** Tests the connection to the destination API, creates a test channel, posts a single message with an attachment, and then cleans up the created channel and message.

- **`migrate`**:
  - An aggregate command that executes the `export`, `transform`, and `import` commands in sequence for a seamless end-to-end migration.
  - Will accept all arguments from all three commands.

## 6. Data Formats

The migration process uses two main data files: `export.json` for the raw exported data and `import.json` for the data transformed for import.

### 6.1. Export Format (`export.json`)

The `export` command generates an `export.json` file containing the raw data from Google Chat, preserving the original API structure. This allows for inspection and debugging before transformation.

#### 6.1.1. File Structure

```
/
├── /attachments/
│   ├── attachment_1.png
│   └── attachment_2.pdf
├── /avatars/
│   ├── 113850239791407514368.jpg
│   └── 987654321098765432109.jpg
└── export.json
```

#### 6.1.2. `export.json` Specification

The main JSON file has a root object containing an export timestamp and spaces with embedded user data.

- **`export_timestamp`**: ISO timestamp of when the export was created.
- **`spaces`**: An array of all Google Chat spaces (channels) to be migrated. Each space object contains its messages with complete user information, including local avatar file paths.

### 6.2. Slack Import Format (`import.json`)

The `transform` command takes the `export.json` file and converts it into an `import.json` file, which is structured for the Slack API.

#### 6.2.1. `import.json` Specification

The `import.json` file contains a list of channels to be created, each with its messages formatted for Slack.

- **`channels`**: An array of channel objects. Each object defines the channel's name and contains the messages to be imported.
- **`messages`**: Each message object includes the author's email (for user mapping), the message text, and information about threads and attachments.

## 7. Testing

To ensure the reliability and correctness of the migration script, the following testing strategy will be implemented, adhering to project standards:

- **Unit Tests:** Focused unit tests will be written for critical business logic and utility functions. This includes:
  - Data transformation logic (e.g., mapping Google Chat objects to the intermediate format).
  - Client service logic for interacting with Google Chat and Slack APIs.
  - **Dependency Isolation:** Dependencies, such as the Google Chat and Slack API clients, will be mocked using `vi.mock` to isolate units of code and ensure tests are fast and reliable.
  - **Structure:** Tests will be clearly structured using `describe`, `it`, and `expect`. Setup and teardown logic will be handled with `beforeEach` and `afterEach` where necessary.

- **End-to-End Tests:** The primary CLI commands (`export`, `import`, `migrate`) will be tested end-to-end. These tests will cover the "happy path" and critical edge cases to verify the entire workflow. This will involve running the script against mock data and asserting the output is as expected.

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
│   │   └── commands/           # Tests for commands
│   │       └── login.test.ts   # Tests for the `login` command
│   ├── cli/
│   │   ├── commands/           # Command implementations (e.g. login, export)
│   │   │   ├── login.ts        # Implements `login <service>`
│   │   │   ├── logout.ts       # Implements `logout <service>`
│   │   │   ├── export.ts       # Implements `export <service>`
│   │   │   ├── import.ts       # Implements `import <service>`
│   │   │   └── migrate.ts
│   │   └── parser.ts           # Argument parsing logic (e.g., using yargs)
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

This plan breaks the project into four main phases. For each step, implement the required functionality and then verify it with unit and manual tests to ensure correctness before proceeding.

**Note on Verification:** After each step, run `pnpm lint` and fix linting errors to ensure code quality and consistency. All verification steps, including manual tests and linting, must pass before moving to the next step.

## Phase 1: Google Chat Export Functionality ✅ COMPLETED

**Objective:** Build the commands and logic to export chat history from Google Chat, preserving the source data format.

1.  **✅ Implement `login` and `logout` for Google Chat**
    - **Action:** Implement the `login <service>` and `logout <service>` commands. For this phase, add support for the `google-chat` service. `login` will handle the OAuth 2.0 flow and store credentials securely. `logout` will clear them.
    - **Status:** COMPLETED - OAuth 2.0 flow implemented with secure token storage using system keychain.
    - **Verification:** Commands `pnpm start login google-chat` and `pnpm start logout google-chat` are working correctly.

2.  **✅ Implement `export google-chat` Command**
    - **Action:** Create the `export <service>` command and implement the logic for `google-chat`. It should accept `--space`, `--output`, and `--dry-run` arguments.
    - **Status:** COMPLETED - Command implemented with all required arguments.
    - **Verification:** `pnpm start export google-chat --help` shows correct argument definitions.

3.  **✅ Implement Data Fetching Logic**
    - **Action:** Implement the service logic to list a user's spaces and fetch all messages for a given space, including handling API pagination, attachment downloads, and avatar downloads.
    - **Status:** COMPLETED - Full implementation including:
      - Space listing with pagination
      - Message fetching with pagination
      - Attachment downloads via Google Chat `media.download` API
      - Avatar downloads via Google People API
      - Proper authentication scopes for all required APIs
    - **Additional Features:** Avatar downloads, user profile fetching, local file management.

4.  **✅ Finalize Export and Test End-to-End**
    - **Action:** Connect the data fetching logic to the `export google-chat` command, writing the complete export data including downloaded files to the specified output directory.
    - **Status:** COMPLETED - End-to-end export functionality working including:
      - Directory structure creation (`attachments/`, `avatars/`)
      - File downloads and local path updates in JSON
      - Unified dry-run implementation using options pattern (eliminates code duplication)
      - Dry-run tests the actual production logic with limited scope (1 message, 1 space)
      - Complete error handling and authentication
    - **Verification:** `pnpm start export google-chat --dry-run` successfully exports data with downloaded avatars.
    - **Architecture:** Refactored to use single `exportGoogleChatData()` function with `ExportOptions` interface, following Node.js/TypeScript best practices.

## Phase 2: Data Transformation

**Objective:** Build the command to transform the exported Google Chat data into the format required for Slack.

1.  **Implement `transform` Command**
    - **Action:** Create the `transform` command. It should accept `--input` and `--output` arguments.
    - **Verification:** Run `pnpm start transform --help` to ensure arguments are correctly defined.

2.  **Implement Data Transformation Logic**
    - **Action:** Create the data transformation logic that converts the Google Chat export data (`export.json`) into the Slack import format (`import.json`). This involves mapping Google Chat spaces to Slack channels and Google Chat messages to Slack messages.
    - **Verification:** Write focused unit tests to validate the transformation for different data structures (e.g., text, attachments, threads).

3.  **Finalize Transform and Test End-to-End**
    - **Action:** Connect the transformation logic to the `transform` command, reading the `export.json` file and writing the final `import.json` file.
    - **Verification:** Perform a manual end-to-end test by running `pnpm start transform --input /tmp/export.json --output /tmp/import.json`. Inspect the output JSON file to confirm its structure and content are correct for a Slack import.

## Phase 3: Slack Import Functionality

**Objective:** Build the commands and logic to import data from the **transformed** `import.json` file into a Slack workspace.

1.  **Enhance `login` and `logout` for Slack**
    - **Action:** Extend the `login <service>` and `logout <service>` commands to handle the `slack` service, managing its API credentials.
    - **Verification:** Update unit tests for `login`/`logout` to cover Slack. Manually run `pnpm start login slack` and `pnpm start logout slack`.

2.  **Implement `import` Command**
    - **Action:** Create the `import` command. It will only support importing to Slack for now. It should accept `--input` and `--channel` arguments.
    - **Verification:** Run `pnpm start import --help` to ensure arguments are correctly defined.

3.  **Implement Import Logic**
    - **Action:** Implement the service logic to:
      1.  Read and parse the `import.json` data file.
      2.  Map users to Slack users (e.g., by email).
      3.  Find or create the target Slack channel.
      4.  Post messages to the channel, respecting Slack's rate limits.
    - **Verification:** Write unit tests for the user mapping and data parsing logic. Use mocked Slack API clients to test channel lookup and message posting.

4.  **Test End-to-End Import**
    - **Action:** Connect the import logic to the `import` command.
    - **Verification:** Perform a manual end-to-end test by running `pnpm start import --input /tmp/import.json --channel <test-channel-name>`. Check the target Slack channel to confirm messages and attachments were imported correctly.

## Phase 4: Combined Migration Command

**Objective:** Create a single, seamless command to orchestrate the entire migration from a source to a destination.

1.  **Implement `migrate` Command**
    - **Action:** Create the top-level `migrate` command that accepts arguments for the source, destination, and any other required parameters.
    - **Verification:** Run `migrate --help` to ensure all arguments are correctly defined.

2.  **Implement Migration Orchestration**
    - **Action:** Implement the orchestration logic that reuses the services from the previous phases. The data should be passed in-memory between steps (`export` -> `transform` -> `import`) without writing to temporary files.
    - **Verification:** Write unit tests for the orchestration logic, mocking the underlying services.

3.  **Add User Feedback**
    - **Action:** Enhance the command to provide real-time feedback, such as a progress bar and a final summary report.
    - **Verification:** Manually run the command and confirm that progress is displayed and a summary is printed upon completion.

4.  **Final End-to-End Test**
    - **Action:** Perform a full, end-to-end test of the `migrate` command.
    - **Verification:** Run `pnpm start migrate --from google-chat --to slack --google-space <test-space-id> --slack-channel <test-channel-name>` and verify that the entire chat history is successfully migrated.
