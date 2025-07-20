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

function getUser(userId: string): Promise<User | null> {
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
        console.warn(`User not found: ${userId}`);
        return null;
      }
      throw error;
    }
  });
}

function downloadFileFromUrl(
  fileUrl: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(outputPath);
    let _totalBytes = 0;

    function handleRequest(requestUrl: string, redirectCount = 0): void {
      if (redirectCount > 5) {
        file.close();
        unlink(outputPath, () => reject(new Error('Too many redirects')));
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
            unlink(outputPath, () =>
              reject(
                new Error(
                  `HTTP ${response.statusCode}: ${response.statusMessage || 'Unknown error'}`
                )
              )
            );
            return;
          }

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
        })
        .on('error', (err) => {
          file.close();
          unlink(outputPath, () => reject(err));
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
        throw new Error(
          `Access denied to attachment ${resourceName}. You may lack permission to access this resource.`
        );
      }
      if (response.status === 404) {
        throw new Error(`Attachment ${resourceName} not found.`);
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
        throw new Error(
          `Access denied to Google Drive file ${driveFileId}. The file may be private or you may lack permission to access it.`
        );
      }
      if (gaxiosError.response?.status === 404) {
        throw new Error(`Google Drive file ${driveFileId} not found.`);
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
  logPrefix: string
): Promise<void> {
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
  } else if (attachment.downloadUri) {
    // Fallback to downloadUri (may require browser session)
    await downloadAuthenticatedUrl(attachment.downloadUri, attachmentPath);
    attachment.localFilePath = attachmentPath;
  } else {
    console.warn(
      `${logPrefix}No download method available for: ${uniqueFilename}`
    );
    console.warn(
      `${logPrefix}Attachment source: ${attachment.source}, has driveDataRef: ${!!attachment.driveDataRef}, has attachmentDataRef: ${!!attachment.attachmentDataRef}`
    );
  }
}

async function processAttachment(
  attachment: GoogleAttachment,
  index: number,
  messageId: string,
  attachmentsDir: string,
  isDryRun: boolean,
  logPrefix: string
): Promise<void> {
  const filename = generateAttachmentFilename(attachment, index);
  const extension = getFileExtension(attachment);
  const uniqueFilename = `${messageId}_${filename}_${index}${extension}`;
  const attachmentPath = path.join(attachmentsDir, uniqueFilename);

  if (isDryRun) {
    attachment.localFilePath = attachmentPath;
    return;
  }

  // Download full attachment
  try {
    await downloadAttachmentFile(
      attachment,
      attachmentPath,
      uniqueFilename,
      logPrefix
    );
  } catch (error) {
    const gaxiosError = error as GaxiosError;
    const statusCode = gaxiosError.response?.status;
    const errorData = gaxiosError.response?.data;
    console.warn(
      `${logPrefix}Failed to download attachment ${uniqueFilename}: ${statusCode} - ${error instanceof Error ? error.message : String(error)}`
    );
    if (errorData) {
      console.warn(`${logPrefix}Error details:`, errorData);
    }
  }
}

async function processMessage(
  message: GoogleMessage,
  avatarsDir: string,
  attachmentsDir: string,
  isDryRun = false
): Promise<void> {
  const logPrefix = isDryRun ? '[Dry Run] ' : '';

  if (message.sender) {
    const user = await getUser(message.sender.name);
    if (user?.avatarUrl) {
      const avatarPath = path.join(
        avatarsDir,
        `${user.name.replace(USER_ID_REGEX, '')}.jpg`
      );
      if (isDryRun) {
        user.avatarUrl = avatarPath;
      } else {
        await downloadFileFromUrl(user.avatarUrl, avatarPath);
        user.avatarUrl = avatarPath;
      }
    }
    if (user) {
      message.sender = user;
    }
  }

  // Handle both "attachments" and "attachment" fields
  const allAttachments = [
    ...(message.attachments || []),
    ...(message.attachment || []),
  ];

  if (allAttachments.length > 0) {
    const attachmentsToProcess = isDryRun
      ? allAttachments.slice(0, 1)
      : allAttachments;

    const messageId = message.name.split('/').pop() || 'unknown';

    await Promise.all(
      attachmentsToProcess.map(async (attachment, index) =>
        processAttachment(
          attachment,
          index,
          messageId,
          attachmentsDir,
          isDryRun,
          logPrefix
        )
      )
    );
  }
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

export async function exportGoogleChatData(
  spaceName: string | undefined,
  outputPath: string,
  options: ExportOptions = {}
): Promise<void> {
  const { dryRun = false, messageLimit, spaceLimit = 1 } = options;
  const logPrefix = dryRun ? '[Dry Run] ' : '';

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

  const exportedSpaces: (Space & { messages: GoogleMessage[] })[] =
    await Promise.all(
      targetSpaces.map(async (space) => {
        const fetchLimit = dryRun ? (messageLimit ?? 1) : undefined;

        if (dryRun) {
          console.log(
            `${logPrefix}Fetching ${fetchLimit} message(s) from space: ${space.displayName}`
          );
        } else {
          console.log(`Fetching messages from space: ${space.displayName}`);
        }

        const messages = await listMessages(space.name, fetchLimit);
        console.log(
          `${logPrefix}Found ${messages.length} message(s) in ${space.displayName}.`
        );

        await Promise.all(
          messages.map(async (message) => {
            await processMessage(message, avatarsDir, attachmentsDir, dryRun);
          })
        );

        return {
          ...space,
          messages,
        };
      })
    );

  const exportData = {
    export_timestamp: new Date().toISOString(),
    spaces: exportedSpaces,
  };

  await writeFile(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`${logPrefix}Exported data to ${outputPath}`);

  // Count attachments for summary
  let totalAttachments = 0;
  let driveFiles = 0;
  for (const space of exportedSpaces) {
    for (const message of space.messages) {
      const attachments = [
        ...(message.attachments || []),
        ...(message.attachment || []),
      ];
      totalAttachments += attachments.length;
      driveFiles += attachments.filter(
        (a) => a.driveDataRef?.driveFileId
      ).length;
    }
  }

  if (totalAttachments > 0) {
    console.log(`\n📎 Attachment Summary:`);
    console.log(`   Total attachments found: ${totalAttachments}`);
    console.log(`   Google Drive files: ${driveFiles}`);
    console.log(`   Chat attachments: ${totalAttachments - driveFiles}`);
  }
}
