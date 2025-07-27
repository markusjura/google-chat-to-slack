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
    yargs
      .positional('provider', {
        describe: 'The chat provider to log in to (google, slack)',
        type: 'string',
        choices: ['google', 'slack'],
        demandOption: true,
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
    try {
      if (argv.provider === 'google') {
        await loginToGoogle();
      } else if (argv.provider === 'slack') {
        await loginToSlack();
      } else {
        console.error(`Unsupported provider: ${argv.provider}`);
        process.exit(1);
      }
      // Clean exit after successful login
      process.exit(0);
    } catch (error) {
      console.error('Login failed:', error);
      process.exit(1);
    }
  },
};
