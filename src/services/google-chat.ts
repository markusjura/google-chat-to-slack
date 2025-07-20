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

async function processDryRunMessage(
  message: GoogleMessage,
  avatarsDir: string,
  attachmentsDir: string
): Promise<void> {
  if (message.sender) {
    const user = await getUser(message.sender.name);
    if (user?.avatarUrl) {
      const avatarPath = path.join(
        avatarsDir,
        `${user.name.replace(USER_ID_REGEX, '')}.jpg`
      );
      console.log(`[Dry Run] Downloading avatar for user: ${user.name}`);
      await downloadFileFromUrl(user.avatarUrl, avatarPath);
      user.avatarUrl = avatarPath;
    }
    if (user) {
      message.sender = user;
    }
  }

  if (message.attachments && message.attachments.length > 0) {
    const attachment = message.attachments[0];
    if (attachment.resourceName) {
      const attachmentPath = path.join(attachmentsDir, attachment.contentName);
      console.log(
        `[Dry Run] Downloading attachment: ${attachment.contentName}`
      );
      await downloadAttachment(attachment.resourceName, attachmentPath);
      attachment.downloadUri = attachmentPath;
    }
  }
}

async function exportGoogleChatDataDryRun(
  spaceId: string | undefined,
  outputPath: string
): Promise<void> {
  const allSpaces = await listSpaces();
  let targetSpaces: Space[];

  if (spaceId) {
    targetSpaces = allSpaces.filter((s) => s.name === `spaces/${spaceId}`);
  } else {
    targetSpaces = allSpaces.length > 0 ? [allSpaces[0]] : [];
  }

  if (targetSpaces.length === 0) {
    console.log(
      `No spaces found. If you provided a space ID, ensure it's correct.`
    );
    return;
  }

  const space = targetSpaces[0];
  const outputDir = path.dirname(outputPath);
  const avatarsDir = path.join(outputDir, 'avatars');
  const attachmentsDir = path.join(outputDir, 'attachments');
  await mkdir(avatarsDir, { recursive: true });
  await mkdir(attachmentsDir, { recursive: true });

  console.log(`[Dry Run] Fetching 1 message from space: ${space.displayName}`);
  const messages = await listMessages(space.name, 1);
  console.log(`[Dry Run] Found ${messages.length} message(s).`);

  if (messages.length > 0) {
    await processDryRunMessage(messages[0], avatarsDir, attachmentsDir);
  }

  const exportedSpace = {
    ...space,
    messages,
  };

  const exportData = {
    export_timestamp: new Date().toISOString(),
    spaces: [exportedSpace],
  };

  await writeFile(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`[Dry Run] Exported data to ${outputPath}`);
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
  dryRun?: boolean
): Promise<void> {
  if (dryRun) {
    await exportGoogleChatDataDryRun(spaceId, outputPath);
    return;
  }

  const spaces = await listSpaces();
  const targetSpaces = spaceId
    ? spaces.filter((s) => s.name === `spaces/${spaceId}`)
    : spaces;

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
        console.log(`Fetching messages from space: ${space.displayName}`);
        const messages = await listMessages(space.name);
        console.log(
          `Found ${messages.length} messages in ${space.displayName}.`
        );

        await Promise.all(
          messages.map(async (message) => {
            if (message.sender) {
              const user = await getUser(message.sender.name);
              if (user?.avatarUrl) {
                const avatarPath = path.join(
                  avatarsDir,
                  `${user.name.replace(USER_ID_REGEX, '')}.jpg`
                );
                await downloadFileFromUrl(user.avatarUrl, avatarPath);
                user.avatarUrl = avatarPath;
              }
              if (user) {
                message.sender = user;
              }
            }

            if (message.attachments) {
              await Promise.all(
                message.attachments.map(async (attachment) => {
                  if (attachment.resourceName) {
                    const attachmentPath = path.join(
                      attachmentsDir,
                      attachment.contentName
                    );
                    await downloadAttachment(
                      attachment.resourceName,
                      attachmentPath
                    );
                    attachment.downloadUri = attachmentPath;
                  }
                })
              );
            }
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
  console.log(`Exported data to ${outputPath}`);
}
