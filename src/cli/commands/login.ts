import type { CommandModule } from 'yargs';
import { loginToGoogle } from '../../services/google-chat';
import { loginToSlack } from '../../services/slack';

type LoginArgs = {
  provider: string;
};

export const loginCommand: CommandModule<object, LoginArgs> = {
  command: 'login <provider>',
  describe: 'Login to a chat provider',
  builder: (yargs) =>
    yargs.positional('provider', {
      describe: 'The chat provider to log in to (e.g., google, slack)',
      type: 'string',
      demandOption: true,
    }),
  handler: async (argv) => {
    if (argv.provider === 'google') {
      await loginToGoogle();
    } else if (argv.provider === 'slack') {
      await loginToSlack();
    } else {
      console.error(`Unsupported service: ${argv.provider}`);
    }
  },
};
