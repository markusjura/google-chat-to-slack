import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { loginToGoogleChat } from '../services/google-chat';
import { deleteToken } from '../utils/token-manager';

export function getParser() {
  const parser = yargs(hideBin(process.argv));

  parser.command(
    'login <service>',
    'Login to a chat service',
    (yargs) => {
      return yargs.positional('service', {
        describe: 'The chat service to log in to (e.g., google-chat)',
        type: 'string',
        demandOption: true,
      });
    },
    async (argv) => {
      if (argv.service === 'google-chat') {
        await loginToGoogleChat();
      } else {
        console.error(`Unsupported service: ${argv.service}`);
      }
    }
  );

  parser.command(
    'logout <service>',
    'Logout from a chat service',
    (yargs) => {
      return yargs.positional('service', {
        describe: 'The chat service to log out from (e.g., google-chat)',
        type: 'string',
        demandOption: true,
      });
    },
    async (argv) => {
      if (argv.service === 'google-chat') {
        await deleteToken('google-chat');
        console.log('Successfully logged out from Google Chat.');
      } else {
        console.error(`Unsupported service: ${argv.service}`);
      }
    }
  );

  parser.command(
    'export <service>',
    'Export data from a chat service',
    (yargs) => {
      return yargs.positional('service', {
        describe: 'The chat service to export from (e.g., google-chat)',
        type: 'string',
        demandOption: true,
      });
    },
    (argv) => {
      if (argv.service === 'google-chat') {
        console.log('Exporting from Google Chat...');
      } else {
        console.error(`Unsupported service: ${argv.service}`);
      }
    }
  );

  return parser;
}
