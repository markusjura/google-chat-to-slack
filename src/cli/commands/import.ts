import path from 'node:path';
import type { CommandModule } from 'yargs';
import { importSlackData } from '../../services/slack';
import { findExistingImportDirectory } from '../../utils/data-directory';
import {
  configureForImport,
  IMPORT_RATE_LIMITS,
} from '../../utils/rate-limiting';

function validateChannelsAndRenames(
  inputDir: string,
  channelFilters?: string | string[],
  channelRenames?: string | string[]
): void {
  if (
    (!channelFilters ||
      (Array.isArray(channelFilters) && channelFilters.length === 0)) &&
    (!channelRenames ||
      (Array.isArray(channelRenames) && channelRenames.length === 0))
  ) {
    return;
  }

  try {
    const fs = require('node:fs');
    const importDataPath = path.join(inputDir, 'import.json');

    if (!fs.existsSync(importDataPath)) {
      console.error('Import data not found. Please run transform first.');
      process.exit(1);
    }

    const importData = JSON.parse(fs.readFileSync(importDataPath, 'utf-8'));
    const availableChannels = importData.channels.map((ch: any) => ch.name);

    validateChannelFilters(channelFilters, availableChannels);
    validateChannelRenames(channelRenames, availableChannels);
  } catch (error) {
    console.error('Failed to validate channels:', error);
    process.exit(1);
  }
}

function validateChannelFilters(
  channelFilters: string | string[] | undefined,
  availableChannels: string[]
): void {
  if (
    !channelFilters ||
    (Array.isArray(channelFilters) && channelFilters.length === 0)
  ) {
    return;
  }

  const channelArray = Array.isArray(channelFilters)
    ? channelFilters
    : [channelFilters];
  const invalidChannels = channelArray.filter(
    (ch: string) => !availableChannels.includes(ch)
  );

  if (invalidChannels.length > 0) {
    console.error(`Invalid channel(s): ${invalidChannels.join(', ')}`);
    console.error(`Available channels: ${availableChannels.join(', ')}`);
    process.exit(1);
  }
}

function validateChannelRenames(
  channelRenames: string | string[] | undefined,
  availableChannels: string[]
): void {
  if (
    !channelRenames ||
    (Array.isArray(channelRenames) && channelRenames.length === 0)
  ) {
    return;
  }

  const renameArray = Array.isArray(channelRenames)
    ? channelRenames
    : [channelRenames];
  const invalidRenames: string[] = [];

  for (const rename of renameArray) {
    const [oldName] = rename.split('=');
    if (!oldName) {
      console.error(
        `Invalid rename format: ${rename}. Expected format: old-name=new-name`
      );
      process.exit(1);
    }
    if (!availableChannels.includes(oldName)) {
      invalidRenames.push(oldName);
    }
  }

  if (invalidRenames.length > 0) {
    console.error(
      `Invalid channel(s) for rename: ${invalidRenames.join(', ')}`
    );
    console.error(`Available channels: ${availableChannels.join(', ')}`);
    process.exit(1);
  }
}

type ImportArgs = {
  input?: string;
  channel?: string | string[];
  dryRun?: boolean;
  clean?: boolean;
  channelRename?: string | string[];
};

export const importCommand: CommandModule<object, ImportArgs> = {
  command: 'import',
  describe: 'Import transformed data to Slack workspace',
  builder: (yargs) =>
    yargs
      .option('input', {
        describe: 'Path to the import directory (defaults to latest import)',
        type: 'string',
      })
      .option('channel', {
        describe:
          'Filter to import only specified channels (can be used multiple times)',
        type: 'string',
        array: true,
      })
      .option('dry-run', {
        describe: 'Test connection, create/delete test channel and message',
        type: 'boolean',
      })
      .option('channel-prefix', {
        describe: 'Prefix to add to channel names during import',
        type: 'string',
      })
      .option('channel-rename', {
        describe:
          'Rename channels during import (format: old-name=new-name, can be used multiple times)',
        type: 'string',
        array: true,
      })
      .strict()
      .fail((msg, err, yargsInstance) => {
        if (msg) {
          console.error(`Error: ${msg}`);
          console.error('');
          yargsInstance.showHelp();
        } else if (err) {
          console.error(`Error: ${err.message}`);
        }
        process.exit(1);
      }),
  handler: async (argv) => {
    // Determine input directory
    let inputDir = argv.input;
    if (!inputDir) {
      const importDir = findExistingImportDirectory();
      if (!importDir) {
        console.error(
          'No import directory found. Please run transform first or specify --input'
        );
        process.exit(1);
      }
      inputDir = importDir;
      console.log(`Using import directory: ${inputDir}`);
    }

    // Validate channel filters and renames if provided
    validateChannelsAndRenames(inputDir, argv.channel, argv.channelRename);

    // Configure rate limiting for import operations
    configureForImport(IMPORT_RATE_LIMITS);

    try {
      await importSlackData(inputDir, argv.channel, {
        dryRun: argv.dryRun,
        channelPrefix: argv.channelPrefix as string | undefined,
        channelRename: argv.channelRename as string[] | undefined,
      });
    } catch (error) {
      console.error('Import failed:', error);
      process.exit(1);
    }
  },
};
