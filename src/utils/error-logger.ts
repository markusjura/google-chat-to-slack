import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ErrorEntry {
  timestamp: string;
  type: 'attachment_download' | 'user_fetch' | 'avatar_download';
  identifier: string;
  message: string;
  details?: string;
}

export class ErrorLogger {
  private errors: ErrorEntry[] = [];

  addError(
    type: ErrorEntry['type'],
    identifier: string,
    message: string,
    details?: string
  ): void {
    this.errors.push({
      timestamp: new Date().toISOString(),
      type,
      identifier,
      message,
      details,
    });
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  getErrorCount(): number {
    return this.errors.length;
  }

  getErrorsByType(): Record<ErrorEntry['type'], number> {
    const counts = {
      attachment_download: 0,
      user_fetch: 0,
      avatar_download: 0,
    };

    for (const error of this.errors) {
      counts[error.type]++;
    }

    return counts;
  }

  async writeErrorLog(outputDir: string): Promise<string> {
    if (!this.hasErrors()) {
      return '';
    }

    const errorLogPath = path.join(outputDir, 'errors.log');
    const logContent = this.formatErrorLog();

    await writeFile(errorLogPath, logContent, 'utf-8');
    return errorLogPath;
  }

  private formatErrorLog(): string {
    const header = `Chat Migrator Export Errors
Generated: ${new Date().toISOString()}
Total Errors: ${this.errors.length}

${'='.repeat(80)}

`;

    const errorEntries = this.errors
      .map((error, index) => {
        const entry = `[${index + 1}] ${error.timestamp}
Type: ${error.type.replace('_', ' ').toUpperCase()}
Item: ${error.identifier}
Error: ${error.message}`;

        return error.details
          ? `${entry}
Details: ${error.details}`
          : entry;
      })
      .join('\n\n');

    return `${header + errorEntries}\n`;
  }
}
