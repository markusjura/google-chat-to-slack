import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { CommandModule } from 'yargs';
import { transformGoogleChatToSlack } from '../../services/transformation';

function getExportDirectory(): string | undefined {
  const exportDir = path.resolve('data/export');
  const fs = require('node:fs');

  try {
    return fs.existsSync(exportDir) && fs.statSync(exportDir).isDirectory()
      ? exportDir
      : undefined;
  } catch {
    return;
  }
}

type TransformArgs = {
  input?: string;
  output?: string;
  dryRun?: boolean;
};

export const transformCommand: CommandModule<object, TransformArgs> = {
  command: 'transform',
  describe: 'Transform exported Google Chat data to Slack import format',
  builder: (yargs) =>
    yargs
      .option('input', {
        describe: 'Path to the export directory (defaults to latest export)',
        type: 'string',
      })
      .option('output', {
        describe: 'Path to the output directory for transformed data',
        type: 'string',
      })
      .option('dry-run', {
        describe: 'Show transformation statistics without writing files',
        type: 'boolean',
      }),
  handler: async (argv) => {
    // Determine input directory
    let inputDir = argv.input;
    if (!inputDir) {
      const exportDir = getExportDirectory();
      if (!exportDir) {
        console.error(
          'No export directory found. Please run export first or specify --input'
        );
        process.exit(1);
      }
      inputDir = exportDir;
      console.log(`Using export directory: ${inputDir}`);
    }

    // Determine output directory
    let outputDir = argv.output;
    if (!outputDir) {
      outputDir = path.resolve('data/import');
    }

    try {
      if (!argv.dryRun) {
        // Remove existing directory if it exists, then create fresh
        const fs = require('node:fs');
        if (fs.existsSync(outputDir)) {
          await fs.promises.rm(outputDir, { recursive: true, force: true });
        }
        await mkdir(outputDir, { recursive: true });
        console.log(`Output directory: ${outputDir}`);
      }

      await transformGoogleChatToSlack(inputDir, outputDir, {
        dryRun: argv.dryRun,
      });
    } catch (error) {
      console.error('Transformation failed:', error);
      process.exit(1);
    }
  },
};
