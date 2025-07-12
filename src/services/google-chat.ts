import { OAuth2Client } from 'google-auth-library';
import { setToken } from '../utils/token-manager';
import * as http from 'http';
import * as url from 'url';
import { config } from '../config';

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
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url) {
          const parsedUrl = url.parse(req.url, true);
          const authCode = parsedUrl.query.code as string;
          if (authCode) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('Authentication successful! You can close this tab.');
            server.close();
            resolve(authCode);
          } else {
            res.writeHead(400).end('No code found in redirect.');
            server.close();
            reject(new Error('No code found in redirect.'));
          }
        }
      } catch (e) {
        res.writeHead(500).end('Internal server error.');
        server.close();
        reject(e);
      }
    });

    server.listen(3000, () => {
      console.log('Listening for redirect on http://localhost:3000');
      import('open').then(({ default: open }) => {
        open(authUrl);
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });

  const { tokens } = await oAuth2Client.getToken(code);
  if (tokens.refresh_token) {
    await setToken('google-chat', tokens.refresh_token);
    console.log('Successfully logged in to Google Chat.');
  } else {
    console.error('Failed to get refresh token.');
  }
}
