import type { CommandModule } from 'yargs';
import { deleteToken } from '../../utils/token-manager';

type LogoutArgs = {
  service: string;
};

export const logoutCommand: CommandModule<object, LogoutArgs> = {
  command: 'logout <service>',
  describe: 'Logout from a chat service',
  builder: (yargs) =>
    yargs.positional('service', {
      describe: 'The chat service to logout from (e.g., google-chat, slack)',
      type: 'string',
      demandOption: true,
    }),
  handler: async (argv) => {
    if (argv.service === 'google-chat') {
      await deleteToken('google-chat');
      console.log('Successfully logged out from Google Chat.');
    } else if (argv.service === 'slack') {
      await deleteToken('slack');
      console.log('Successfully logged out from Slack.');
    } else {
      console.error(`Unsupported service: ${argv.service}`);
    }
  },
};
