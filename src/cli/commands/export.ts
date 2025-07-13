import type { CommandModule } from 'yargs';

type ExportArgs = {
  service: string;
};

export const exportCommand: CommandModule<object, ExportArgs> = {
  command: 'export <service>',
  describe: 'Export data from a chat service',
  builder: (yargs) =>
    yargs.positional('service', {
      describe: 'The chat service to export from (e.g., google-chat)',
      type: 'string',
      demandOption: true,
    }),
  handler: (argv) => {
    if (argv.service === 'google-chat') {
      console.log('Exporting from Google Chat...');
    } else {
      console.error(`Unsupported service: ${argv.service}`);
    }
  },
};
