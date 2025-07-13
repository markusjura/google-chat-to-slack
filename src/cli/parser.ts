import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { exportCommand } from './commands/export';

export function getParser() {
  const parser = yargs(hideBin(process.argv));

  parser.command(loginCommand);
  parser.command(logoutCommand);
  parser.command(exportCommand);

  return parser;
}
