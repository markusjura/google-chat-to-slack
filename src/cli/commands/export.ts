import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { CommandModule } from 'yargs';
import { exportGoogleChatData, listSpaces } from '../../services/google-chat';

type ExportArgs = {
  service: string;
  space?: string;
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
      .option('space', {
        describe: 'The ID of the space to export',
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
      let spaceName = 'all-spaces';
      if (argv.space) {
        const spaces = await listSpaces();
        const currentSpace = spaces.find(
          (s) => s.name === `spaces/${argv.space}`
        );
        if (currentSpace) {
          spaceName =
            currentSpace.displayName?.replace(/\s/g, '-') ?? argv.space;
        }
      }

      const timestamp = new Date().toISOString();
      const outputDir = path.resolve(argv.output, `${spaceName}-${timestamp}`);
      console.log('outputDir', outputDir);

      await mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, 'export.json');
      console.log('outputPath', outputPath);
      await exportGoogleChatData(argv.space, outputPath, argv.dryRun);
    } else {
      console.error(`Unsupported service: ${argv.service}`);
    }
  },
};
