import { createWriteStream, unlink } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import url from 'node:url';
import type { GaxiosError, GaxiosResponse } from 'gaxios';
import { OAuth2Client } from 'google-auth-library';
import { type chat_v1, google } from 'googleapis';
import { config } from '../config';
import type { GoogleMessage, Space, User } from '../types/google-chat';
import { getToken, setToken } from '../utils/token-manager';

const REDIRECT_URI = 'http://localhost:3000';
const USER_ID_REGEX = /^(users\/|people\/)/;

const SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
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
  import('open').then(({ default: open }) => open(authUrl));

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

async function getUser(userId: string): Promise<User | null> {
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
}

function downloadFileFromUrl(
  fileUrl: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(outputPath);
    https
      .get(fileUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`Failed to get '${fileUrl}' (${response.statusCode})`)
          );
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        unlink(outputPath, () => reject(err));
      });
  });
}

async function downloadAttachment(
  resourceName: string,
  outputPath: string
): Promise<void> {
  const chat = await getGoogleChatClient();
  const res = await chat.media.download(
    { resourceName },
    { responseType: 'stream' }
  );
  const dest = createWriteStream(outputPath);
  res.data.pipe(dest);
  await new Promise<void>((resolve, reject) => {
    dest.on('finish', () => resolve());
    dest.on('error', reject);
  });
}

export async function listSpaces(): Promise<Space[]> {
  const chat = await getGoogleChatClient();
  const spaces: Space[] = [];
  let pageToken: string | undefined;

  do {
    // biome-ignore lint/nursery/noAwaitInLoop: The Google Chat API uses pagination, and we need to await each page.
    const res = (await chat.spaces.list({
      pageSize: 100,
      pageToken,
    })) as unknown as GaxiosResponse<chat_v1.Schema$ListSpacesResponse>;

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
        console.log(`${logPrefix}Downloading avatar for user: ${user.name}`);
      }
      await downloadFileFromUrl(user.avatarUrl, avatarPath);
      user.avatarUrl = avatarPath;
    }
    if (user) {
      message.sender = user;
    }
  }

  if (message.attachments) {
    const attachmentsToProcess = isDryRun
      ? message.attachments.slice(0, 1)
      : message.attachments;

    await Promise.all(
      attachmentsToProcess.map(async (attachment) => {
        if (attachment.resourceName) {
          const attachmentPath = path.join(
            attachmentsDir,
            attachment.contentName
          );
          if (isDryRun) {
            console.log(
              `${logPrefix}Downloading attachment: ${attachment.contentName}`
            );
          }
          await downloadAttachment(attachment.resourceName, attachmentPath);
          attachment.downloadUri = attachmentPath;
        }
      })
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
    const res = (await chat.spaces.messages.list({
      parent: spaceName,
      pageSize: limit ?? 1000,
      pageToken,
    })) as unknown as GaxiosResponse<chat_v1.Schema$ListMessagesResponse>;

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
  spaceId: string | undefined,
  outputPath: string,
  options: ExportOptions = {}
): Promise<void> {
  const { dryRun = false, messageLimit, spaceLimit = 1 } = options;
  const logPrefix = dryRun ? '[Dry Run] ' : '';

  const allSpaces = await listSpaces();
  let targetSpaces = spaceId
    ? allSpaces.filter((s) => s.name === `spaces/${spaceId}`)
    : allSpaces;

  // Apply space limit for dry-run
  if (dryRun) {
    targetSpaces = targetSpaces.slice(0, spaceLimit);
  }

  if (targetSpaces.length === 0) {
    console.log(
      `No spaces found. If you provided a space ID, ensure it's correct.`
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
}
