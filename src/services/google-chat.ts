import http from 'node:http';
import url from 'node:url';
import type { GaxiosResponse } from 'gaxios';
import { OAuth2Client } from 'google-auth-library';
import { type chat_v1, google } from 'googleapis';
import { config } from '../config';
import type { Message, Space } from '../types/google-chat';
import { getToken, setToken } from '../utils/token-manager';

const REDIRECT_URI = 'http://localhost:3000';

const SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
];

function getOauth2Client(): OAuth2Client {
  return new OAuth2Client(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

export async function loginToGoogleChat(): Promise<void> {
  const oAuth2Client = getOauth2Client();

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Authorize this app by visiting this url:', authUrl);

  const code = await new Promise<string>((resolve, reject) => {
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
      import('open').then(({ default: open }) => open(authUrl));
    });

    server.on('error', reject);
  });

  const { tokens } = await oAuth2Client.getToken(code);
  if (tokens.refresh_token) {
    await setToken('google-chat', tokens.refresh_token);
    console.log('Successfully logged in to Google Chat.');
  } else {
    console.error('Failed to get refresh token.');
  }
}

async function getGoogleChatClient(): Promise<chat_v1.Chat> {
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

  return google.chat({
    version: 'v1',
    auth: oAuth2Client,
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

export async function listMessages(spaceName: string): Promise<Message[]> {
  const chat = await getGoogleChatClient();
  const messages: Message[] = [];
  let pageToken: string | undefined;

  do {
    // biome-ignore lint/nursery/noAwaitInLoop: The Google Chat API uses pagination, and we need to await each page.
    const res = (await chat.spaces.messages.list({
      parent: spaceName,
      pageSize: 1000,
      pageToken,
    })) as unknown as GaxiosResponse<chat_v1.Schema$ListMessagesResponse>;

    if (res.data.messages) {
      messages.push(...(res.data.messages as Message[]));
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return messages;
}
