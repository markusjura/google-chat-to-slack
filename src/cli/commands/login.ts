import type { CommandModule } from 'yargs';
import { loginToGoogleChat } from '../../services/google-chat';

type LoginArgs = {
  service: string;
};

export const loginCommand: CommandModule<object, LoginArgs> = {
  command: 'login <service>',
  describe: 'Login to a chat service',
  builder: (yargs) =>
    yargs.positional('service', {
      describe: 'The chat service to log in to (e.g., google-chat)',
      type: 'string',
      demandOption: true,
    }),
  handler: async (argv) => {
    if (argv.service === 'google-chat') {
      await loginToGoogleChat();
    } else {
      console.error(`Unsupported service: ${argv.service}`);
    }
  },
};
