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
        describe: 'The chat provider to log in to (google-chat, slack)',
        type: 'string',
        choices: ['google-chat', 'slack'],
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
    if (argv.provider === 'google-chat') {
      await loginToGoogle();
    } else if (argv.provider === 'slack') {
      await loginToSlack();
    } else {
      console.error(`Unsupported provider: ${argv.provider}`);
      process.exit(1);
    }
  },
};
