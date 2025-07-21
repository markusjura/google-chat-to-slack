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
  GoogleAttachment,
  GoogleMessage,
  Space,
  User,
} from '../types/google-chat';
import { Logger } from '../utils/logger';
import { ProgressBar } from '../utils/progress-bar';
import { googleChatProjectRateLimiter } from '../utils/rate-limiter';
import { getToken, setToken } from '../utils/token-manager';

const REDIRECT_URI = 'http://localhost:3000';
const USER_ID_REGEX = /^(users\/|people\/)/;

const SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'profile',
  'email',
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

export async function loginToGoogleChat(): Promise<void> {
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
    await setToken('google-chat', tokens.refresh_token);
    console.log('Successfully logged in to Google Chat.');
  } else {
    console.error('Failed to get refresh token.');
  }
}

async function getAuthenticatedOauth2Client(): Promise<OAuth2Client> {
  const oAuth2Client = getOauth2Client();
  const refreshToken = await getToken('google-chat');
  if (!refreshToken) {
    throw new Error(
      'User not authenticated. Please run "login google-chat" first.'
    );
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

function getUser(userId: string, logger: Logger): Promise<User | null> {
  return googleChatProjectRateLimiter.execute(async () => {
    try {
      const oAuth2Client = await getAuthenticatedOauth2Client();
      const people = google.people({ version: 'v1', auth: oAuth2Client });
      const res = await people.people.get({
        resourceName: `people/${userId.replace('users/', '')}`,
        personFields: 'names,emailAddresses,photos',
      });

      const user = res.data;
      if (!user) {
        return null;
      }

      return {
        name: user.resourceName ?? '',
        displayName: user.names?.[0]?.displayName ?? '',
        email: user.emailAddresses?.[0]?.value ?? '',
        avatarUrl: user.photos?.[0]?.url ?? '',
        type: 'HUMAN',
      };
    } catch (error) {
      const gaxiosError = error as GaxiosError;
      if (gaxiosError.response?.status === 404) {
        logger.addWarning('user_fetch', userId, 'User not found');
        return null;
      }
      if (gaxiosError.response?.status === 403) {
        logger.addPermissionWarning('user_fetch', userId, 'user profile');
        return null;
      }
      logger.addError(
        'user_fetch',
        userId,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  });
}

function downloadFileFromUrl(
  fileUrl: string,
  outputPath: string,
  logger: Logger,
  identifier: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const file = createWriteStream(outputPath);
    let _totalBytes = 0;

    function handleRequest(requestUrl: string, redirectCount = 0): void {
      if (redirectCount > 5) {
        file.close();
        unlink(outputPath, () => {
          logger.addError('avatar_download', identifier, 'Too many redirects');
          resolve(false);
        });
        return;
      }

      const protocol = requestUrl.startsWith('https:') ? https : http;

      protocol
        .get(requestUrl, (response) => {
          // Handle redirects
          if (
            response.statusCode === 301 ||
            response.statusCode === 302 ||
            response.statusCode === 307 ||
            response.statusCode === 308
          ) {
            const location = response.headers.location;
            if (location) {
              handleRequest(location, redirectCount + 1);
              return;
            }
          }

          if (response.statusCode !== 200) {
            file.close();
            unlink(outputPath, () => {
              const statusCode = response.statusCode || 0;
              if (statusCode === 403) {
                logger.addPermissionWarning(
                  'avatar_download',
                  identifier,
                  'avatar'
                );
              } else if (statusCode === 404) {
                logger.addWarning(
                  'avatar_download',
                  identifier,
                  'Avatar not found'
                );
              } else {
                logger.addError(
                  'avatar_download',
                  identifier,
                  `HTTP ${statusCode}: ${response.statusMessage || 'Unknown error'}`
                );
              }
              resolve(false);
            });
            return;
          }

          response.on('data', (chunk) => {
            _totalBytes += chunk.length;
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve(true);
          });

          file.on('error', (err) => {
            file.close();
            unlink(outputPath, () => {
              logger.addError('avatar_download', identifier, err.message);
              resolve(false);
            });
          });

          response.on('error', (err) => {
            file.close();
            unlink(outputPath, () => {
              logger.addError('avatar_download', identifier, err.message);
              resolve(false);
            });
          });
        })
        .on('error', (err) => {
          file.close();
          unlink(outputPath, () => {
            logger.addError('avatar_download', identifier, err.message);
            resolve(false);
          });
        });
    }

    handleRequest(fileUrl);
  });
}

function downloadAttachment(
  resourceName: string,
  outputPath: string
): Promise<void> {
  return googleChatProjectRateLimiter.execute(async () => {
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
  return googleChatProjectRateLimiter.execute(async () => {
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
    const res = await googleChatProjectRateLimiter.execute(async () => {
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
  return await googleChatProjectRateLimiter.execute(async () => {
    const oAuth2Client = await getAuthenticatedOauth2Client();

    // Get access token for Authorization header
    const { token: accessToken } = await oAuth2Client.getAccessToken();

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlString);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'chat-migrator/1.0.0',
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
  avatarsProcessed: number;
  avatarsSuccessful: number;
}

interface ExportSummaryOptions {
  attachmentsProcessed: number;
  attachmentsSuccessful: number;
  avatarsProcessed: number;
  avatarsSuccessful: number;
  driveFiles: number;
  logger: Logger;
  logPath: string;
  isDryRun: boolean;
}

function displayExportSummary(options: ExportSummaryOptions): void {
  const {
    attachmentsProcessed,
    attachmentsSuccessful,
    avatarsProcessed,
    avatarsSuccessful,
    driveFiles,
    logger,
    logPath,
    isDryRun,
  } = options;

  if (attachmentsProcessed === 0 && avatarsProcessed === 0) {
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

  if (avatarsProcessed > 0) {
    console.log(
      `   Avatars: ${avatarsSuccessful}/${avatarsProcessed} downloaded successfully`
    );
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

async function processMessageSender(
  message: GoogleMessage,
  avatarsDir: string,
  isDryRun: boolean,
  logger: Logger
): Promise<{ processed: number; successful: number }> {
  if (!message.sender) {
    return { processed: 0, successful: 0 };
  }

  const user = await getUser(message.sender.name, logger);
  if (!user?.avatarUrl) {
    if (user) {
      message.sender = user;
    }
    return { processed: 0, successful: 0 };
  }

  const avatarPath = path.join(
    avatarsDir,
    `${user.name.replace(USER_ID_REGEX, '')}.jpg`
  );

  if (isDryRun) {
    user.avatarUrl = avatarPath;
    message.sender = user;
    return { processed: 1, successful: 1 };
  }

  const success = await downloadFileFromUrl(
    user.avatarUrl,
    avatarPath,
    logger,
    user.name.replace(USER_ID_REGEX, '')
  );

  if (success) {
    user.avatarUrl = avatarPath;
  }
  message.sender = user;
  return { processed: 1, successful: success ? 1 : 0 };
}

async function processMessageAttachments(
  message: GoogleMessage,
  attachmentsDir: string,
  isDryRun: boolean,
  logger: Logger
): Promise<{ processed: number; successful: number }> {
  const allAttachments = [
    ...(message.attachments || []),
    ...(message.attachment || []),
  ];

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
  avatarsDir: string,
  attachmentsDir: string,
  isDryRun: boolean,
  logger: Logger
): Promise<ProcessMessageResult> {
  const avatarResult = await processMessageSender(
    message,
    avatarsDir,
    isDryRun,
    logger
  );
  const attachmentResult = await processMessageAttachments(
    message,
    attachmentsDir,
    isDryRun,
    logger
  );

  return {
    attachmentsProcessed: attachmentResult.processed,
    attachmentsSuccessful: attachmentResult.successful,
    avatarsProcessed: avatarResult.processed,
    avatarsSuccessful: avatarResult.successful,
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
    const res = await googleChatProjectRateLimiter.execute(async () => {
      return (await chat.spaces.messages.list({
        parent: spaceName,
        pageSize: limit ?? 1000,
        pageToken,
      })) as unknown as GaxiosResponse<chat_v1.Schema$ListMessagesResponse>;
    });

    if (res.data.messages) {
      messages.push(...(res.data.messages as GoogleMessage[]));
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

async function getSpaceOverviews(
  targetSpaces: Space[],
  dryRun: boolean,
  messageLimit?: number
): Promise<SpaceOverview[]> {
  const overviews: SpaceOverview[] = [];

  for (const space of targetSpaces) {
    const fetchLimit = dryRun ? (messageLimit ?? 1) : undefined;
    // biome-ignore lint/nursery/noAwaitInLoop: Sequential space processing is required for rate limiting and progress tracking
    const messages = await listMessages(space.name, fetchLimit);

    overviews.push({
      space,
      messageCount: messages.length,
      messages,
    });
  }

  return overviews;
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
  console.log(`   Spaces: ${overviews.length}`);
  console.log(`   Total Messages: ${totalMessages}`);

  if (overviews.length > 1) {
    console.log('\n   Space Details:');
    for (const overview of overviews) {
      console.log(
        `   • ${overview.space.displayName}: ${overview.messageCount} messages`
      );
    }
  }

  console.log(''); // Add blank line before progress
}

export async function exportGoogleChatData(
  spaceName: string | undefined,
  outputPath: string,
  options: ExportOptions = {}
): Promise<void> {
  const { dryRun = false, messageLimit, spaceLimit = 1 } = options;
  const logPrefix = dryRun ? '[Dry Run] ' : '';
  const logger = new Logger();

  const allSpaces = await listSpaces();
  let targetSpaces = spaceName
    ? allSpaces.filter((s) => s.displayName === spaceName)
    : allSpaces;

  // Apply space limit for dry-run
  if (dryRun) {
    targetSpaces = targetSpaces.slice(0, spaceLimit);
  }

  if (targetSpaces.length === 0) {
    console.log(
      `No spaces found. If you provided a space name, ensure it's correct.`
    );
    return;
  }

  const outputDir = path.dirname(outputPath);
  const avatarsDir = path.join(outputDir, 'avatars');
  const attachmentsDir = path.join(outputDir, 'attachments');
  await mkdir(avatarsDir, { recursive: true });
  await mkdir(attachmentsDir, { recursive: true });

  // Get overview of all spaces and messages first
  const spaceOverviews = await getSpaceOverviews(
    targetSpaces,
    dryRun,
    messageLimit
  );
  displayExportOverview(spaceOverviews, dryRun);

  // Statistics tracking
  let totalAttachmentsProcessed = 0;
  let totalAttachmentsSuccessful = 0;
  let totalAvatarsProcessed = 0;
  let totalAvatarsSuccessful = 0;
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
              avatarsDir,
              attachmentsDir,
              dryRun,
              logger
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
          totalAvatarsProcessed += result.avatarsProcessed;
          totalAvatarsSuccessful += result.avatarsSuccessful;
        }

        // Count drive files for this space
        for (const message of messages) {
          const attachments = [
            ...(message.attachments || []),
            ...(message.attachment || []),
          ];
          totalDriveFiles += attachments.filter(
            (a) => a.driveDataRef?.driveFileId
          ).length;
        }

        return {
          ...space,
          messages,
        };
      })
    );

  // Finish progress bar
  progressBar?.finish();

  const exportData = {
    export_timestamp: new Date().toISOString(),
    spaces: exportedSpaces,
  };

  await writeFile(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`${logPrefix}Exported data to ${outputPath}`);

  // Write error log if there are errors or warnings
  let logPath = '';
  if (logger.hasIssues() && !dryRun) {
    logPath = await logger.writeLog();
  }

  displayExportSummary({
    attachmentsProcessed: totalAttachmentsProcessed,
    attachmentsSuccessful: totalAttachmentsSuccessful,
    avatarsProcessed: totalAvatarsProcessed,
    avatarsSuccessful: totalAvatarsSuccessful,
    driveFiles: totalDriveFiles,
    logger,
    logPath,
    isDryRun: dryRun,
  });
}
