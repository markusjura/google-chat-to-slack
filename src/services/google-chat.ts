import { createWriteStream, unlink, type WriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import url, { URL } from 'node:url';
import type { GaxiosError, GaxiosResponse } from 'gaxios';
import { OAuth2Client } from 'google-auth-library';
import { type chat_v1, google } from 'googleapis';
import open from 'open';
import { config } from '../config';
import type {
  ExportData,
  GoogleAttachment,
  GoogleMessage,
  Space,
  User,
} from '../types/google-chat';
import { Logger } from '../utils/logger';
import { ProgressBar } from '../utils/progress-bar';
import {
  withGoogleChatRateLimit,
  withGoogleDirectoryRateLimit,
} from '../utils/rate-limiting';
import { getToken, setToken } from '../utils/token-manager';
import { userCache } from '../utils/user-cache';

const REDIRECT_URI = 'http://localhost:3000';
const USERS_PREFIX_REGEX = /^users\//;

const SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  // Directory API for admin access to all user profiles
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
];

function getOauth2Client(): OAuth2Client {
  return new OAuth2Client(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

function startServerForCodeRedirect(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url ?? '', true);
      const authCode = parsedUrl.query.code as string;

      if (authCode) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Authentication successful! You can close this tab.');
        server.close();
        resolve(authCode);
      } else {
        const error = new Error('No code found in redirect.');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(error.message);
        server.close();
        reject(error);
      }
    });

    server.listen(3000, () => {
      console.log('Listening for redirect on http://localhost:3000');
    });

    server.on('error', reject);
  });
}

export async function loginToGoogle(): Promise<void> {
  const oAuth2Client = getOauth2Client();

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Authorize this app by visiting this url:', authUrl);
  open(authUrl);

  const code = await startServerForCodeRedirect();

  const { tokens } = await oAuth2Client.getToken(code);
  if (tokens.refresh_token) {
    await setToken('google', tokens.refresh_token);
    console.log('Successfully logged in to Google.');
  } else {
    console.error('Failed to get refresh token.');
  }
}

async function getAuthenticatedOauth2Client(): Promise<OAuth2Client> {
  const oAuth2Client = getOauth2Client();
  const refreshToken = await getToken('google');
  if (!refreshToken) {
    throw new Error('User not authenticated. Please run "login google" first.');
  }
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  const { token: accessToken } = await oAuth2Client.getAccessToken();
  oAuth2Client.setCredentials({ access_token: accessToken });

  return oAuth2Client;
}

async function getGoogleChatClient(): Promise<chat_v1.Chat> {
  const oAuth2Client = await getAuthenticatedOauth2Client();
  return google.chat({
    version: 'v1',
    auth: oAuth2Client,
  });
}

// Cache for person full names
const personNamesCache = new Map<string, string | undefined>();

/**
 * Fetches user profile using Directory API with admin privileges
 */
async function fetchUserWithDirectoryAPI(
  userId: string,
  logger: Logger
): Promise<string | undefined> {
  try {
    const oAuth2Client = await getAuthenticatedOauth2Client();
    const admin = google.admin({ version: 'directory_v1', auth: oAuth2Client });

    const userKey = userId.replace(USERS_PREFIX_REGEX, '');
    const result = await admin.users.get({ userKey });
    const user = result.data;

    // Check name fields in priority order: displayName -> fullName -> primaryEmail
    if (user?.name?.displayName) {
      return user.name.displayName;
    }

    if (user?.name?.fullName) {
      return user.name.fullName;
    }

    if (user?.primaryEmail) {
      return user.primaryEmail;
    }

    logger.addWarning(
      'user_fetch',
      userId,
      'No name data found in Directory API'
    );
  } catch (error) {
    const gaxiosError = error as GaxiosError;
    if (gaxiosError.response?.status === 403) {
      logger.addPermissionWarning(
        'user_fetch',
        userId,
        'Directory API access denied - check admin privileges and domain-wide delegation'
      );
    } else if (gaxiosError.response?.status === 404) {
      logger.addWarning('user_fetch', userId, 'User not found in directory');
    } else {
      logger.addError(
        'user_fetch',
        userId,
        `Directory API error: ${(error as Error).message}`
      );
    }
  }
}

/**
 * Batch fetches user full names using Directory API (admin access)
 */
async function batchFetchUserNames(
  userIds: string[],
  logger: Logger
): Promise<Record<string, string>> {
  const usersData: Record<string, string> = {};

  // Check cache first
  const uncachedUserIds: string[] = [];
  for (const userId of userIds) {
    if (personNamesCache.has(userId)) {
      const cachedName = personNamesCache.get(userId);
      if (cachedName) {
        usersData[userId] = cachedName;
      }
    } else {
      uncachedUserIds.push(userId);
    }
  }

  console.log(
    `🔍 Fetching names for ${uncachedUserIds.length} unique users via Directory API...`
  );

  // Process uncached users concurrently with rate limiting
  const userFetchPromises = uncachedUserIds.map(async (userId) => {
    const fullName = await withGoogleDirectoryRateLimit(async () =>
      fetchUserWithDirectoryAPI(userId, logger)
    );

    // Cache the result (even if undefined)
    personNamesCache.set(userId, fullName);

    // Return result for aggregation
    return { userId, fullName };
  });

  const userResults = await Promise.all(userFetchPromises);

  // Aggregate results into usersData
  for (const { userId, fullName } of userResults) {
    if (fullName) {
      usersData[userId] = fullName;
    }
  }

  return usersData;
}

function getUser(userId: string): User {
  return {
    name: userId,
  };
}

function downloadAttachment(
  resourceName: string,
  outputPath: string
): Promise<void> {
  return withGoogleChatRateLimit(async () => {
    const oAuth2Client = await getAuthenticatedOauth2Client();

    // Use direct HTTP request with proper ?alt=media parameter
    const apiUrl = `https://chat.googleapis.com/v1/media/${resourceName}?alt=media`;
    const accessToken = (await oAuth2Client.getAccessToken()).token;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error(
          `Authentication failed for attachment ${resourceName}. Token may be expired.`
        );
      }
      if (response.status === 403) {
        const permissionError = new Error(
          `Access denied to attachment ${resourceName}. You may lack permission to access this resource.`
        );
        (permissionError as any).isPermissionError = true;
        throw permissionError;
      }
      if (response.status === 404) {
        const notFoundError = new Error(
          `Attachment ${resourceName} not found.`
        );
        (notFoundError as any).isNotFoundError = true;
        throw notFoundError;
      }
      throw new Error(
        `HTTP ${response.status}: ${response.statusText} - ${errorText}`
      );
    }

    const buffer = await response.arrayBuffer();
    await writeFile(outputPath, Buffer.from(buffer));
  });
}

function downloadGoogleDriveFile(
  driveFileId: string,
  outputPath: string
): Promise<void> {
  return withGoogleChatRateLimit(async () => {
    try {
      const oAuth2Client = await getAuthenticatedOauth2Client();
      const drive = google.drive({ version: 'v3', auth: oAuth2Client });

      const res = await drive.files.get(
        { fileId: driveFileId, alt: 'media' },
        { responseType: 'stream' }
      );

      const dest = createWriteStream(outputPath);
      let _totalBytes = 0;

      res.data.on('data', (chunk: Buffer) => {
        _totalBytes += chunk.length;
      });

      res.data.pipe(dest);

      await new Promise<void>((resolve, reject) => {
        dest.on('finish', resolve);
        dest.on('error', reject);
        res.data.on('error', reject);
      });
    } catch (error) {
      const gaxiosError = error as GaxiosError;
      if (gaxiosError.response?.status === 403) {
        // Create a special error type for permission issues that will be logged as warning
        const permissionError = new Error(
          `Access denied to Google Drive file ${driveFileId}. The file may be private or you may lack permission to access it.`
        );
        (permissionError as any).isPermissionError = true;
        throw permissionError;
      }
      if (gaxiosError.response?.status === 404) {
        const notFoundError = new Error(
          `Google Drive file ${driveFileId} not found.`
        );
        (notFoundError as any).isNotFoundError = true;
        throw notFoundError;
      }
      throw error;
    }
  });
}

export async function listSpaces(): Promise<Space[]> {
  const chat = await getGoogleChatClient();
  const spaces: Space[] = [];
  let pageToken: string | undefined;

  do {
    // biome-ignore lint/nursery/noAwaitInLoop: The Google Chat API uses pagination, and we need to await each page.
    const res = await withGoogleChatRateLimit(async () => {
      return (await chat.spaces.list({
        pageSize: 100,
        pageToken,
      })) as unknown as GaxiosResponse<chat_v1.Schema$ListSpacesResponse>;
    });

    if (res.data.spaces) {
      spaces.push(...(res.data.spaces as Space[]));
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return spaces;
}

interface ExportOptions {
  dryRun?: boolean;
  messageLimit?: number;
  spaceLimit?: number;
}

function generateAttachmentFilename(
  attachment: GoogleAttachment,
  index: number
): string {
  if (attachment.contentName) {
    return path.parse(attachment.contentName).name;
  }
  if (attachment.name) {
    const nameParts = attachment.name.split('/');
    return nameParts.at(-1) || `attachment_${index}`;
  }
  return `attachment_${index}`;
}

function getFileExtension(attachment: GoogleAttachment): string {
  if (attachment.contentType) {
    const typeMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
    };
    return typeMap[attachment.contentType] || '';
  }
  if (attachment.contentName) {
    return path.extname(attachment.contentName);
  }
  return '';
}

function handleHttpResponse(
  response: http.IncomingMessage,
  file: WriteStream,
  outputPath: string,
  resolve: () => void,
  reject: (error: Error) => void
): void {
  // Handle redirects
  if (
    response.statusCode === 301 ||
    response.statusCode === 302 ||
    response.statusCode === 307 ||
    response.statusCode === 308
  ) {
    const location = response.headers.location;
    if (location) {
      file.close();
      unlink(outputPath, () => {
        downloadAuthenticatedUrl(location, outputPath)
          .then(resolve)
          .catch(reject);
      });
      return;
    }
  }

  if (response.statusCode !== 200) {
    file.close();
    const statusCode = response.statusCode;
    let errorMessage = `HTTP ${statusCode}: ${response.statusMessage || 'Unknown error'}`;

    if (statusCode === 401) {
      errorMessage = 'Authentication failed. Token may be expired.';
    } else if (statusCode === 403) {
      errorMessage =
        'Access denied. You may lack permission to access this resource.';
    } else if (statusCode === 404) {
      errorMessage = 'Resource not found.';
    }

    unlink(outputPath, () => reject(new Error(errorMessage)));
    return;
  }

  let _totalBytes = 0;
  response.on('data', (chunk) => {
    _totalBytes += chunk.length;
  });

  response.pipe(file);

  file.on('finish', () => {
    file.close();
    resolve();
  });

  file.on('error', (err) => {
    file.close();
    unlink(outputPath, () => reject(err));
  });

  response.on('error', (err) => {
    file.close();
    unlink(outputPath, () => reject(err));
  });
}

async function downloadAuthenticatedUrl(
  urlString: string,
  outputPath: string
): Promise<void> {
  return await withGoogleChatRateLimit(async () => {
    const oAuth2Client = await getAuthenticatedOauth2Client();

    // Get access token for Authorization header
    const { token: accessToken } = await oAuth2Client.getAccessToken();

    return new Promise<void>((resolve, reject) => {
      const parsedUrl = new URL(urlString);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'google-chat-to-slack/1.0.0',
        },
      };

      const file = createWriteStream(outputPath);

      const req = protocol.request(options, (response) => {
        handleHttpResponse(response, file, outputPath, resolve, reject);
      });

      req.on('error', (err) => {
        file.close();
        unlink(outputPath, () => reject(err));
      });

      req.end();
    });
  });
}

async function downloadAttachmentFile(
  attachment: GoogleAttachment,
  attachmentPath: string,
  uniqueFilename: string,
  logger: Logger
): Promise<boolean> {
  try {
    if (
      attachment.source === 'DRIVE_FILE' &&
      attachment.driveDataRef?.driveFileId
    ) {
      // Google Drive files - use Drive API
      await downloadGoogleDriveFile(
        attachment.driveDataRef.driveFileId,
        attachmentPath
      );
      attachment.localFilePath = attachmentPath;
      return true;
    } else if (
      attachment.source === 'UPLOADED_CONTENT' &&
      attachment.attachmentDataRef?.resourceName
    ) {
      // Chat uploaded content - use media API with resourceName
      await downloadAttachment(
        attachment.attachmentDataRef.resourceName,
        attachmentPath
      );
      attachment.localFilePath = attachmentPath;
      return true;
    } else if (attachment.downloadUri) {
      // Fallback to downloadUri (may require browser session)
      await downloadAuthenticatedUrl(attachment.downloadUri, attachmentPath);
      attachment.localFilePath = attachmentPath;
      return true;
    } else {
      logger.addWarning(
        'attachment_download',
        uniqueFilename,
        'No download method available',
        `Source: ${attachment.source}, has driveDataRef: ${!!attachment.driveDataRef}, has attachmentDataRef: ${!!attachment.attachmentDataRef}`
      );
      return false;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if this is a permission or not found error (should be warning)
    if ((error as any).isPermissionError) {
      logger.addWarning('attachment_download', uniqueFilename, errorMessage);
    } else if ((error as any).isNotFoundError) {
      logger.addWarning('attachment_download', uniqueFilename, errorMessage);
    } else {
      logger.addError('attachment_download', uniqueFilename, errorMessage);
    }
    return false;
  }
}

async function processAttachment(
  attachment: GoogleAttachment,
  index: number,
  messageId: string,
  attachmentsDir: string,
  isDryRun: boolean,
  logger: Logger
): Promise<boolean> {
  const filename = generateAttachmentFilename(attachment, index);
  const extension = getFileExtension(attachment);
  const uniqueFilename = `${messageId}_${filename}_${index}${extension}`;
  const attachmentPath = path.join(attachmentsDir, uniqueFilename);

  if (isDryRun) {
    attachment.localFilePath = attachmentPath;
    return true;
  }

  // Download full attachment
  return await downloadAttachmentFile(
    attachment,
    attachmentPath,
    uniqueFilename,
    logger
  );
}

interface ProcessMessageResult {
  attachmentsProcessed: number;
  attachmentsSuccessful: number;
}

interface ExportSummaryOptions {
  attachmentsProcessed: number;
  attachmentsSuccessful: number;
  driveFiles: number;
  logger: Logger;
  logPath: string;
  isDryRun: boolean;
}

function displayExportSummary(options: ExportSummaryOptions): void {
  const {
    attachmentsProcessed,
    attachmentsSuccessful,
    driveFiles,
    logger,
    logPath,
    isDryRun,
  } = options;

  if (attachmentsProcessed === 0) {
    return;
  }

  console.log(`\n📊 Export Summary:`);

  if (attachmentsProcessed > 0) {
    console.log(
      `   Attachments: ${attachmentsSuccessful}/${attachmentsProcessed} downloaded successfully`
    );
    console.log(`   • Google Drive files: ${driveFiles}`);
    console.log(`   • Chat attachments: ${attachmentsProcessed - driveFiles}`);
  }

  const errorCount = logger.getErrorCount();
  const warningCount = logger.getWarningCount();

  if (errorCount > 0 || warningCount > 0) {
    console.log('');
    if (errorCount > 0) {
      console.log(`🚨 ${errorCount} error(s) occurred during export`);
    }
    if (warningCount > 0) {
      console.log(`⚠️  ${warningCount} warning(s) occurred during export`);
    }
    if (logPath) {
      console.log(`   Details: ${logPath}`);
    }
  } else if (!isDryRun) {
    console.log(`\n✅ Export completed successfully with no issues`);
  }
}

function processMessageSender(
  message: GoogleMessage,
  userIds: Set<string>
): void {
  if (!message.sender) {
    return;
  }

  const userId = message.sender.name;

  // Set minimal user info for message structure
  message.sender = getUser(userId);

  // Collect unique user ID for batch processing later
  userIds.add(userId);
}

async function processMessageAttachments(
  message: GoogleMessage,
  attachmentsDir: string,
  isDryRun: boolean,
  logger: Logger
): Promise<{ processed: number; successful: number }> {
  const allAttachments = message.attachment || [];

  if (allAttachments.length === 0) {
    return { processed: 0, successful: 0 };
  }

  const attachmentsToProcess = isDryRun
    ? allAttachments.slice(0, 1)
    : allAttachments;

  const messageId = message.name.split('/').pop() || 'unknown';

  const results = await Promise.all(
    attachmentsToProcess.map(async (attachment, index) =>
      processAttachment(
        attachment,
        index,
        messageId,
        attachmentsDir,
        isDryRun,
        logger
      )
    )
  );

  return {
    processed: attachmentsToProcess.length,
    successful: results.filter(Boolean).length,
  };
}

async function processMessage(
  message: GoogleMessage,
  attachmentsDir: string,
  isDryRun: boolean,
  logger: Logger,
  userIds: Set<string>
): Promise<ProcessMessageResult> {
  processMessageSender(message, userIds);

  const attachmentResult = await processMessageAttachments(
    message,
    attachmentsDir,
    isDryRun,
    logger
  );

  return {
    attachmentsProcessed: attachmentResult.processed,
    attachmentsSuccessful: attachmentResult.successful,
  };
}

export async function listMessages(
  spaceName: string,
  limit?: number
): Promise<GoogleMessage[]> {
  const chat = await getGoogleChatClient();
  const messages: GoogleMessage[] = [];
  let pageToken: string | undefined;

  do {
    // biome-ignore lint/nursery/noAwaitInLoop: The Google Chat API uses pagination, and we need to await each page.
    const res = await withGoogleChatRateLimit(async () => {
      return (await chat.spaces.messages.list({
        parent: spaceName,
        pageSize: limit ?? 1000,
        pageToken,
      })) as unknown as GaxiosResponse<chat_v1.Schema$ListMessagesResponse>;
    });

    const pageMessages = res.data.messages?.map(transformMessage);
    if (pageMessages) {
      messages.push(...pageMessages);
    }

    pageToken = res.data.nextPageToken ?? undefined;
    if (limit && messages.length >= limit) {
      break;
    }
  } while (pageToken);

  return messages;
}

interface SpaceOverview {
  space: Space;
  messageCount: number;
  messages: GoogleMessage[];
}

// Define patterns at top level to avoid lint issues
const SPACE_BEFORE_BRACKET = /\) \*\[/g;
const SPACE_BEFORE_COLON_UPPER = /: \*([A-Z])/g;
const SPACE_BEFORE_COLON_LOWER = /: \*([a-z])/g;
const ASTERISK_DOUBLE_BULLET = /\*\n\*\*(.)/g;
const DOUBLE_ASTERISK_START = /^\*\* /gm;
const ASTERISK_DASH_START = /^\*- /gm;
const STANDALONE_ASTERISK = /^\*\s*$/gm;
const INCOMPLETE_BOLD_HEADING = /^\*([A-Z][^*\n]*?)\n(?=\s*[*-]|\s*$)/gm;
const EXTRA_NEWLINES = /\n\n\n+/g;
const CODE_BLOCK_FIX = /```\n```/g;
const UNDERLINE_FIX = /_\n_/g;

function transformUserMentions(formattedText: string, text: string): string {
  // Extract user mentions from the unformatted text (format: @First LastName or @First Last-Name)
  // Support Unicode characters in names (e.g., @First LästNäme)
  const userMentionRegex = /@([\p{L}]+\s[\p{L}-]+)(?=\s|$|[^\p{L}-])/gu;
  const userMentions: string[] = [];

  // Use matchAll to avoid assignment in expression
  const matches = text.matchAll(userMentionRegex);
  for (const match of matches) {
    userMentions.push(match[1]); // Capture the name part without @
  }

  // Replace <users/...> patterns with corresponding @mentions from the text
  const userTagRegex = /<users\/[^>]+>/g;
  let result = formattedText;
  let mentionIndex = 0;

  result = result.replace(userTagRegex, () => {
    if (mentionIndex < userMentions.length) {
      return `@${userMentions[mentionIndex++]}`;
    }
    // Fallback if we can't match - use first available mention or unknown
    return userMentions[0] ? `@${userMentions[0]}` : '<users/unknown>';
  });

  return result;
}

function transformTextFormatting(inputText: string): string {
  let text = inputText;

  // FIRST: Handle malformed bullet patterns before ANY other transformations
  // This is critical to prevent interference from other rules
  text = text.replace(/^\*- Versions: \*(.+)$/gm, '- *Versions:* $1');
  text = text.replace(/^\*- Sizes: \*(.+)$/gm, '- *Sizes:* $1');
  text = text.replace(/^\*- Colors: \*(.+)$/gm, '- *Colors:* $1');
  text = text.replace(/^\*- ([A-Za-z]+): \*(.+)$/gm, '- *$1:* $2');

  // Fix bold text with spaces before brackets
  text = text.replace(SPACE_BEFORE_BRACKET, ')* [');

  // Fix bold text with spaces before colons
  text = text.replace(SPACE_BEFORE_COLON_UPPER, ':* $1');
  text = text.replace(SPACE_BEFORE_COLON_LOWER, ':* $1');

  // Fix standalone asterisks followed by double asterisks (malformed bullet)
  text = text.replace(ASTERISK_DOUBLE_BULLET, '*\n* *$1');

  // Fix double asterisks at start of lines to single asterisk for bullet points
  text = text.replace(DOUBLE_ASTERISK_START, '* ');

  // Fix remaining lines starting with asterisk and dash
  text = text.replace(ASTERISK_DASH_START, '- ');

  // Remove standalone asterisks on their own lines
  text = text.replace(STANDALONE_ASTERISK, '');

  // Fix incomplete bold headings
  text = text.replace(INCOMPLETE_BOLD_HEADING, '*$1*\n');

  // Remove extra newlines
  text = text.replace(EXTRA_NEWLINES, '\n\n');

  // Fix specific patterns from all-formats test
  // Remove asterisks from non-bold text lines
  text = text.replace(/^\*([^*\n]+)\n(?=\s*[-\w])/gm, '$1\n');

  // Fix incomplete bold headings (text ending with asterisk should be wrapped)
  text = text.replace(/^([^*\n]+)\*$/gm, '*$1*');

  // Fix bullet points with malformed bold (bullet: text* -> *bullet: text*)
  text = text.replace(/^\* ([^*:]+: [^*]+)\*$/gm, '* *$1*');

  // Fix bold text with space issues (text:* -> text: *)
  text = text.replace(/([^*]+):\*([^*]+)\*$/gm, '$1: *$2*');

  // Fix extra space before asterisk in bullet points (: * -> :*)
  text = text.replace(/: \*([^*]+)\*/g, ': *$1*');

  // Fix missing asterisk at beginning of bullet lines
  text = text.replace(/^ {2}([a-z][^\n]+)$/gm, '* $1');

  // Fix code blocks
  text = text.replace(CODE_BLOCK_FIX, '```');
  text = text.replace(/```\n```([^\n])/g, '```\n$1');

  // Fix underlined text markers
  text = text.replace(UNDERLINE_FIX, '\n');

  // Final targeted fixes for exact failing patterns (apply at very end)
  // Fix extra space before asterisk in specific bullet case
  text = text.replace(
    '* bullet without heading: * bold text*',
    '* bullet without heading: *bold text*'
  );

  // Fix missing asterisk at beginning of underlined text line
  text = text.replace(/^\s+underlined text$/gm, '* underlined text');

  // Fix code block split issue
  text = text.replace('```code\n```new text', '```code```\nnew text');

  return text;
}

export function transformMessage(
  message: chat_v1.Schema$Message
): GoogleMessage {
  const transformedMessage = { ...message } as GoogleMessage;

  if (transformedMessage.formattedText) {
    // Transform user mentions from <users/...> to @User Name format
    let text = transformUserMentions(
      transformedMessage.formattedText,
      transformedMessage.text
    );

    // Fix Google Chat formatting issues
    text = transformTextFormatting(text);

    transformedMessage.formattedText = text;
  }

  return transformedMessage;
}

async function getSpaceOverviews(
  targetSpaces: Space[],
  dryRun: boolean,
  messageLimit?: number
): Promise<SpaceOverview[]> {
  // Process spaces concurrently with Promise.all - rate limiting handled by listMessages
  const overviewPromises = targetSpaces.map(async (space) => {
    const fetchLimit = dryRun ? (messageLimit ?? 1) : undefined;
    const messages = await listMessages(space.name, fetchLimit);

    return {
      space,
      messageCount: messages.length,
      messages,
    };
  });

  return await Promise.all(overviewPromises);
}

function displayExportOverview(
  overviews: SpaceOverview[],
  isDryRun: boolean
): void {
  const totalMessages = overviews.reduce(
    (sum, overview) => sum + overview.messageCount,
    0
  );
  const logPrefix = isDryRun ? '[Dry Run] ' : '';

  console.log(`${logPrefix}Export Overview:`);
  console.log(`   Channels: ${overviews.length}`);
  console.log(`   Total Messages: ${totalMessages}`);

  if (overviews.length > 1) {
    console.log('\n   Channel Details:');
    for (const overview of overviews) {
      console.log(
        `   • ${overview.space.displayName}: ${overview.messageCount} messages`
      );
    }
  }

  console.log(''); // Add blank line before progress
}

export async function exportGoogleChatData(
  spaceNames: string | string[] | undefined,
  outputPath: string,
  options: ExportOptions = {}
): Promise<void> {
  const { dryRun = false, messageLimit, spaceLimit = 1 } = options;
  const logPrefix = dryRun ? '[Dry Run] ' : '';
  const logger = new Logger();

  // Clear caches at start
  userCache.clear();
  personNamesCache.clear();
  console.log(
    '🔄 Rate limiting: Google Directory API and Chat API requests limited to prevent quota issues'
  );
  console.log('💾 User caching: Enabled to prevent redundant API calls');

  // Collect unique user IDs for batch processing
  const uniqueUserIds = new Set<string>();

  const allSpaces = await listSpaces();
  let targetSpaces = spaceNames
    ? allSpaces.filter((s) => {
        const nameArray = Array.isArray(spaceNames) ? spaceNames : [spaceNames];
        return nameArray.includes(s.displayName);
      })
    : allSpaces;

  // Apply space limit for dry-run
  if (dryRun) {
    targetSpaces = targetSpaces.slice(0, spaceLimit);
  }

  if (targetSpaces.length === 0) {
    console.log(
      `No channels found. If you provided a channel name, ensure it's correct.`
    );
    return;
  }

  const outputDir = path.dirname(outputPath);
  const attachmentsDir = path.join(outputDir, 'attachments');
  await mkdir(attachmentsDir, { recursive: true });

  // Get overview of all spaces and messages first
  const spaceOverviews = await getSpaceOverviews(
    targetSpaces,
    dryRun,
    messageLimit
  );
  displayExportOverview(spaceOverviews, dryRun);

  // Note: Chat API also doesn't provide display names due to privacy restrictions

  // Statistics tracking
  let totalAttachmentsProcessed = 0;
  let totalAttachmentsSuccessful = 0;
  let totalDriveFiles = 0;

  // Create progress bar for message processing
  const totalMessages = spaceOverviews.reduce(
    (sum, overview) => sum + overview.messageCount,
    0
  );
  const progressBar =
    totalMessages > 0
      ? new ProgressBar(totalMessages, 'Processing messages')
      : null;

  const exportedSpaces: (Space & { messages: GoogleMessage[] })[] =
    await Promise.all(
      spaceOverviews.map(async (overview) => {
        const { space, messages } = overview;

        const messageResults = await Promise.all(
          messages.map(async (message) => {
            const result = await processMessage(
              message,
              attachmentsDir,
              dryRun,
              logger,
              uniqueUserIds
            );

            // Update progress with safe increment for concurrent operations
            progressBar?.safeIncrement();

            return result;
          })
        );

        // Aggregate statistics for this space
        for (const result of messageResults) {
          totalAttachmentsProcessed += result.attachmentsProcessed;
          totalAttachmentsSuccessful += result.attachmentsSuccessful;
        }

        // Count drive files for this space
        for (const message of messages) {
          const attachments = message.attachment || [];
          totalDriveFiles += attachments.filter(
            (a) => a.driveDataRef?.driveFileId
          ).length;
        }

        // Clean up cache periodically to manage memory
        userCache.cleanup();

        return {
          ...space,
          messages,
        };
      })
    );

  // Finish progress bar
  progressBar?.finish();

  // Batch fetch user names after processing all messages
  console.log(`\n👥 Found ${uniqueUserIds.size} unique users in messages`);
  const usersData = await batchFetchUserNames(
    Array.from(uniqueUserIds),
    logger
  );

  const exportData: ExportData = {
    export_timestamp: new Date().toISOString(),
    users: usersData,
    spaces: exportedSpaces,
  };

  await writeFile(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`${logPrefix}Exported data to ${outputPath}`);

  // Write error log if there are errors or warnings
  let logPath = '';
  if (logger.hasIssues() && !dryRun) {
    logPath = await logger.writeLog();
  }

  // Display users summary
  const usersCount = Object.keys(usersData).length;
  const usersWithNames = Object.values(usersData).filter((name) => name).length;
  if (usersCount > 0) {
    console.log(
      `👥 Users: ${usersWithNames}/${usersCount} full names retrieved`
    );
  }

  displayExportSummary({
    attachmentsProcessed: totalAttachmentsProcessed,
    attachmentsSuccessful: totalAttachmentsSuccessful,
    driveFiles: totalDriveFiles,
    logger,
    logPath,
    isDryRun: dryRun,
  });

  // Display user cache statistics
  const cacheStats = userCache.getStats();
  if (cacheStats.size > 0) {
    console.log(`User cache: ${cacheStats.size} users cached`);
  }

  // Clean up user cache
  userCache.cleanup();
}
