import path from 'node:path';
import type { CommandModule } from 'yargs';
import { importSlackData } from '../../services/slack';

function getImportDirectory(): string | undefined {
  const importDir = path.resolve('data/import');
  const fs = require('node:fs');

  try {
    return fs.existsSync(importDir) && fs.statSync(importDir).isDirectory()
      ? importDir
      : undefined;
  } catch {
    return;
  }
}

type ImportArgs = {
  input?: string;
  channel?: string | string[];
  dryRun?: boolean;
  clean?: boolean;
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
      .option('clean', {
        describe:
          'Delete and recreate channels before importing (requires channels:manage scope)',
        type: 'boolean',
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
      const importDir = getImportDirectory();
      if (!importDir) {
        console.error(
          'No import directory found. Please run transform first or specify --input'
        );
        process.exit(1);
      }
      inputDir = importDir;
      console.log(`Using import directory: ${inputDir}`);
    }

    // Validate channel filters if provided
    if (argv.channel && argv.channel.length > 0) {
      try {
        const fs = require('node:fs');
        const importDataPath = path.join(inputDir, 'import.json');

        if (!fs.existsSync(importDataPath)) {
          console.error('Import data not found. Please run transform first.');
          process.exit(1);
        }

        const importData = JSON.parse(fs.readFileSync(importDataPath, 'utf-8'));
        const availableChannels = importData.channels.map((ch: any) => ch.name);
        const channelArray = Array.isArray(argv.channel)
          ? argv.channel
          : [argv.channel];
        const invalidChannels = channelArray.filter(
          (ch: string) => !availableChannels.includes(ch)
        );

        if (invalidChannels.length > 0) {
          console.error(`Invalid channel(s): ${invalidChannels.join(', ')}`);
          console.error(`Available channels: ${availableChannels.join(', ')}`);
          process.exit(1);
        }
      } catch (error) {
        console.error('Failed to validate channels:', error);
        process.exit(1);
      }
    }

    try {
      await importSlackData(inputDir, argv.channel, {
        dryRun: argv.dryRun,
        clean: argv.clean,
      });
    } catch (error) {
      console.error('Import failed:', error);
      process.exit(1);
    }
  },
};
