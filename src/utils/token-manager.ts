import { Entry } from '@napi-rs/keyring';

const SERVICE_NAME = 'google-chat-to-slack';

export async function setToken(account: string, token: string): Promise<void> {
  const entry = new Entry(SERVICE_NAME, account);
  await entry.setPassword(token);
}

export async function getToken(account: string): Promise<string | null> {
  try {
    const entry = new Entry(SERVICE_NAME, account);
    return await entry.getPassword();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    // Keyring throws an error if the entry is not found
    return null;
  }
}

export async function deleteToken(account: string): Promise<void> {
  try {
    const entry = new Entry(SERVICE_NAME, account);
    await entry.deletePassword();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    // Ignore error if the entry doesn't exist
  }
}
