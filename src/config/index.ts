import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

// Load .env file if it exists (for development)
if (existsSync('.env')) {
  dotenvConfig();
}

// Try to load config from user's home directory
const configPaths = [
  join(homedir(), '.googletoslack', 'config'),
  join(homedir(), '.config', 'googletoslack', 'config'),
];

for (const configPath of configPaths) {
  if (existsSync(configPath)) {
    try {
      dotenvConfig({ path: configPath });
      break;
    } catch (_error) {
      console.warn(`Warning: Could not load config from ${configPath}`);
    }
  }
}

const configSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  SLACK_BOT_TOKEN: z.string().optional(),
});

const parsedConfig = configSchema.safeParse(process.env);

if (!parsedConfig.success) {
  const errors = parsedConfig.error.flatten().fieldErrors;
  console.error('Missing required environment variables:');

  if (errors.GOOGLE_CLIENT_ID) {
    console.error('  GOOGLE_CLIENT_ID is required');
  }
  if (errors.GOOGLE_CLIENT_SECRET) {
    console.error('  GOOGLE_CLIENT_SECRET is required');
  }

  console.error('\nYou can set these by:');
  console.error('1. Setting environment variables:');
  console.error('   export GOOGLE_CLIENT_ID="your_client_id"');
  console.error('   export GOOGLE_CLIENT_SECRET="your_client_secret"');
  console.error('\n2. Creating a config file at:');
  console.error(`   ${join(homedir(), '.googletoslack', 'config')}`);
  console.error('   or');
  console.error(`   ${join(homedir(), '.config', 'googletoslack', 'config')}`);
  console.error(
    '\n3. For development, create a .env file in the project directory'
  );

  process.exit(1);
}

export const config = parsedConfig.data;
