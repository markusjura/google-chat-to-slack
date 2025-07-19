import type { CommandModule } from 'yargs';
import { exportGoogleChatData } from '../../services/google-chat';

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
        describe: 'The path to the output file',
        type: 'string',
        default: 'export.json',
      })
      .option('dry-run', {
        describe: 'Perform a dry run, exporting only one message per space',
        type: 'boolean',
      }),
  handler: async (argv) => {
    if (argv.service === 'google-chat') {
      await exportGoogleChatData(argv.space, argv.output, argv.dryRun);
    } else {
      console.error(`Unsupported service: ${argv.service}`);
    }
  },
};
