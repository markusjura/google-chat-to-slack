import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { exportCommand } from './commands/export';
import { importCommand } from './commands/import';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { migrateCommand } from './commands/migrate';
import { transformCommand } from './commands/transform';

export function getParser() {
  const parser = yargs(hideBin(process.argv));

  parser.command(loginCommand);
  parser.command(logoutCommand);
  parser.command(migrateCommand);
  parser.command(exportCommand);
  parser.command(transformCommand);
  parser.command(importCommand);

  return parser;
}
