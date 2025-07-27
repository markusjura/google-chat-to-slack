import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Determines the appropriate data directory based on the environment.
 *
 * Development (when run from repository):
 * - Uses local 'data/' directory for easy debugging
 * - Detected by presence of package.json and src/ directory
 *
 * Production (global npm install):
 * - Uses ~/.config/googletoslack/data/ following XDG standard
 * - Keeps user's working directory clean
 */
export function getDataDirectory(): string {
  // Check if we're in development environment (repository)
  const isInRepository =
    existsSync('package.json') &&
    existsSync('src') &&
    existsSync('tsconfig.json');

  if (isInRepository) {
    // Development: use local data directory
    return resolve('data');
  }

  // Production: use config directory
  return join(homedir(), '.config', 'googletoslack', 'data');
}

/**
 * Get the default export directory path
 */
export function getDefaultExportDirectory(): string {
  return join(getDataDirectory(), 'export');
}

/**
 * Get the default import directory path
 */
export function getDefaultImportDirectory(): string {
  return join(getDataDirectory(), 'import');
}

/**
 * Check if an export directory exists and contains data
 */
export function findExistingExportDirectory(): string | undefined {
  const defaultDir = getDefaultExportDirectory();

  try {
    return existsSync(defaultDir) &&
      require('node:fs').statSync(defaultDir).isDirectory()
      ? defaultDir
      : undefined;
  } catch {
    return;
  }
}

/**
 * Check if an import directory exists and contains data
 */
export function findExistingImportDirectory(): string | undefined {
  const defaultDir = getDefaultImportDirectory();

  try {
    return existsSync(defaultDir) &&
      require('node:fs').statSync(defaultDir).isDirectory()
      ? defaultDir
      : undefined;
  } catch {
    return;
  }
}
