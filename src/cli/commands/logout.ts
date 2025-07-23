import type { CommandModule } from 'yargs';
import { deleteToken } from '../../utils/token-manager';

type LogoutArgs = {
  provider: string;
};

export const logoutCommand: CommandModule<object, LogoutArgs> = {
  command: 'logout <provider>',
  describe: 'Logout from a chat provider',
  builder: (yargs) =>
    yargs.positional('provider', {
      describe: 'The chat provider to logout from (e.g., google, slack)',
      type: 'string',
      demandOption: true,
    }),
  handler: async (argv) => {
    if (argv.provider === 'google') {
      await deleteToken('google');
      console.log('Successfully logged out from Google.');
    } else if (argv.provider === 'slack') {
      await deleteToken('slack');
      console.log('Successfully logged out from Slack.');
    } else {
      console.error(`Unsupported provider: ${argv.provider}`);
    }
  },
};
