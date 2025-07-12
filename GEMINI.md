# General

- Every time you choose to apply rules, explicitly state the rules in the output. Be concise and to the point. You can abbreviate the rule description to a single word or phrase.
- Write concise, technical TypeScript code with accurate examples
- Use functional and declarative programming patterns; avoid classes
- Prefer iteration and modularization over code duplication
- Use descriptive variable names with auxiliary verbs (e.g., isLoading, hasError)
- When retrieving information or documentation on our technologies/libraries, use context7 (mcp server)

# Tech Stack

Use the following technologies:

- Node
- pnpm
- TypeScript
- Zod
- Vitest

# Naming Conventions

- Use lowercase with dashes for directories and files (e.g., components/form-wizard/form-section.tsx)
- Favor named exports for components and utilities

# Syntax and Formatting

- Use "function" keyword for pure functions
- Avoid unnecessary curly braces in conditionals
- Use declarative JSX
- Implement proper TypeScript discriminated unions for message types

# Code Structure

- Structure repository files as follows:

```
├── bin/                            # Source for the executable script
│   └── migrate-chat.ts             # Main CLI entry point (compiled to JS for execution)
│
├── src/                            # Application source code
│   ├── __tests__/                  # Vitest unit tests (all tests directly here)
│   │   └── my-feature.test.ts
│   │
│   ├── cli/                        # Command-line interface logic
│   │   ├── commands/               # Specific CLI commands
│   │   │   └── import.ts           # Handles `migrate-chat import`
│   │   └── parser.ts               # CLI argument parsing
│   │
│   ├── config/                     # Application configuration handling
│   │   └── index.ts                # Loads, validates, and manages configuration (uses Zod)
│   │
│   ├── services/                   # Core business logic for migration
│   │   └── migration.ts            # Orchestrates the migration process
│   │
│   ├── types/                      # TypeScript definitions including Zod schemas
│   │   └── app-config.ts           # Zod schema and type for application configuration
│   │
│   └── utils/                      # Shared utility functions and helpers
│       └── logger.ts               # Centralized logging utility
│
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json                   # TypeScript configuration
├── vitest.config.ts                # Vitest configuration
└── README.md
```

# TypeScript Usage

- Use TypeScript for all code; prefer interfaces over types
- Use the Declaration Before Use Principle, putting function declarations at the top and calling/execution code at the bottom of the file
- Avoid enums; use const objects with 'as const' assertion
- Use functional components with TypeScript interfaces
- Define strict types for message passing between different parts of the extension
- Use absolute imports for all files "@/..."
- Avoid try/catch blocks unless there is good reason to translate or handle error in that abstraction
- Use explicit return types for all functions

# Testing

- Test outer scripts end-to-end, covering the happy path and important edge cases.
- Write focused unit tests for complex or critical business logic and utility functions.
- Structure tests clearly using `describe`, `it`, and `expect`.
- Leverage `vi.mock` to isolate units of code by mocking dependencies.
- Use `beforeEach` and `afterEach` for repeatable test setup and teardown.
