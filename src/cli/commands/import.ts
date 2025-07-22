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
  channel?: string;
  dryRun?: boolean;
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
        describe: 'Target Slack channel name for import',
        type: 'string',
      })
      .option('dry-run', {
        describe: 'Test connection, create/delete test channel and message',
        type: 'boolean',
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

    try {
      await importSlackData(inputDir, argv.channel, {
        dryRun: argv.dryRun,
      });
    } catch (error) {
      console.error('Import failed:', error);
      process.exit(1);
    }
  },
};
