import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export type LogLevel = 'error' | 'warning';
export type LogType =
  | 'attachment_download'
  | 'user_fetch'
  | 'avatar_download'
  | 'file_copy'
  | 'file_upload'
  | 'message_post';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  type: LogType;
  identifier: string;
  message: string;
  details?: string;
}

export class Logger {
  private entries: LogEntry[] = [];
  private context: string;

  constructor(context = 'Export') {
    this.context = context;
  }

  addError(
    type: LogType,
    identifier: string,
    message: string,
    details?: string
  ): void {
    this.addEntry('error', type, identifier, message, details);
  }

  addWarning(
    type: LogType,
    identifier: string,
    message: string,
    details?: string
  ): void {
    this.addEntry('warning', type, identifier, message, details);
  }

  addPermissionWarning(
    type: LogType,
    identifier: string,
    resourceType: string
  ): void {
    this.addWarning(
      type,
      identifier,
      `Access denied to ${resourceType}. The resource may be private or you may lack permission to access it.`
    );
  }

  private addEntry(
    level: LogLevel,
    type: LogType,
    identifier: string,
    message: string,
    details?: string
  ): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      level,
      type,
      identifier,
      message,
      details,
    });
  }

  hasErrors(): boolean {
    return this.getErrorCount() > 0;
  }

  hasWarnings(): boolean {
    return this.getWarningCount() > 0;
  }

  hasIssues(): boolean {
    return this.entries.length > 0;
  }

  getErrorCount(): number {
    return this.entries.filter((entry) => entry.level === 'error').length;
  }

  getWarningCount(): number {
    return this.entries.filter((entry) => entry.level === 'warning').length;
  }

  getTotalCount(): number {
    return this.entries.length;
  }

  getErrorsByType(): Record<LogType, number> {
    const counts = {
      attachment_download: 0,
      user_fetch: 0,
      avatar_download: 0,
      file_copy: 0,
      file_upload: 0,
      message_post: 0,
    };

    for (const entry of this.entries.filter((e) => e.level === 'error')) {
      counts[entry.type]++;
    }

    return counts;
  }

  getWarningsByType(): Record<LogType, number> {
    const counts = {
      attachment_download: 0,
      user_fetch: 0,
      avatar_download: 0,
      file_copy: 0,
      file_upload: 0,
      message_post: 0,
    };

    for (const entry of this.entries.filter((e) => e.level === 'warning')) {
      counts[entry.type]++;
    }

    return counts;
  }

  async writeLog(baseDir?: string): Promise<string> {
    if (!this.hasIssues()) {
      return '';
    }

    // Use centralized logs directory
    const logsDir = baseDir
      ? path.join(baseDir, 'data', 'logs')
      : path.resolve('data/logs');
    const logPath = path.join(logsDir, 'output.log');
    const logContent = this.formatLog();

    // Ensure logs directory exists
    const { mkdir } = require('node:fs/promises');
    await mkdir(logsDir, { recursive: true });

    await writeFile(logPath, logContent, 'utf-8');
    return logPath;
  }

  private formatLog(): string {
    const errors = this.entries.filter((entry) => entry.level === 'error');
    const warnings = this.entries.filter((entry) => entry.level === 'warning');

    const header = `Chat Migrator ${this.context} Log
Generated: ${new Date().toISOString()}
Total Issues: ${this.getTotalCount()} (${errors.length} errors, ${warnings.length} warnings)

${'='.repeat(80)}

`;

    let content = header;

    if (errors.length > 0) {
      content += `ERRORS (${errors.length})\n`;
      content += `${'='.repeat(20)}\n\n`;

      content += errors
        .map((entry, index) => this.formatEntry(entry, index + 1, 'ERROR'))
        .join('\n\n');

      content += '\n\n';
    }

    if (warnings.length > 0) {
      content += `WARNINGS (${warnings.length})\n`;
      content += `${'='.repeat(20)}\n\n`;

      content += warnings
        .map((entry, index) => this.formatEntry(entry, index + 1, 'WARNING'))
        .join('\n\n');

      content += '\n';
    }

    return content;
  }

  private formatEntry(
    entry: LogEntry,
    index: number,
    levelLabel: string
  ): string {
    const baseEntry = `[${index}] ${entry.timestamp}
Level: ${levelLabel}
Type: ${entry.type.replace('_', ' ').toUpperCase()}
Item: ${entry.identifier}
Message: ${entry.message}`;

    return entry.details
      ? `${baseEntry}
Details: ${entry.details}`
      : baseEntry;
  }
}
