import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { CommandModule } from 'yargs';
import { exportGoogleChatData } from '../../services/google-chat';

type ExportArgs = {
  service: string;
  channel?: string;
  output: string;
  dryRun?: boolean;
};

export const exportCommand: CommandModule<object, ExportArgs> = {
  command: 'export <service>',
  describe: 'Export data from a chat service',
  builder: (yargs) =>
    yargs
      .positional('service', {
        describe: 'The chat service to export from (e.g., google-chat)',
        type: 'string',
        demandOption: true,
      })
      .option('channel', {
        describe: 'The name of the Google Chat space to export',
        type: 'string',
      })
      .option('output', {
        describe: 'The path to the output directory',
        type: 'string',
        default: 'data/export',
      })
      .option('dry-run', {
        describe: 'Perform a dry run, exporting only one message per space',
        type: 'boolean',
      }),
  handler: async (argv) => {
    if (argv.service === 'google-chat') {
      const outputDir = path.resolve(argv.output);
      console.log('outputDir', outputDir);

      // Remove existing directory if it exists, then create fresh
      const fs = require('node:fs');
      if (fs.existsSync(outputDir)) {
        await fs.promises.rm(outputDir, { recursive: true, force: true });
      }
      await mkdir(outputDir, { recursive: true });

      const outputPath = path.join(outputDir, 'export.json');
      console.log('outputPath', outputPath);
      await exportGoogleChatData(argv.channel, outputPath, {
        dryRun: argv.dryRun,
      });
    } else {
      console.error(`Unsupported service: ${argv.service}`);
    }
  },
};
