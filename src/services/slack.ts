import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WebClient } from '@slack/web-api';
import { config } from '../config';
import type {
  SlackChannel,
  SlackConversationsListResponse,
  SlackImportAttachment,
  SlackImportData,
  SlackImportMessage,
} from '../types/slack';
import { Logger } from '../utils/logger';
import { ProgressBar } from '../utils/progress-bar';
import { getToken, setToken } from '../utils/token-manager';

// Interface for message arguments to replace 'any' type
interface SlackMessageArgs {
  channel: string;
  text: string;
  thread_ts?: string;
}

interface ImportOptions {
  dryRun?: boolean;
}

// Function declarations (following Declaration Before Use principle)

// Removed getSenderDisplayName and USER_ID_REGEX - display names are now included directly in messages

async function testSlackToken(
  token: string
): Promise<{ team?: string; user?: string; user_id?: string } | undefined> {
  try {
    const slack = new WebClient(token);
    const result = await slack.auth.test();
    if (result.ok) {
      return {
        team: result.team as string,
        user: result.user as string,
        user_id: result.user_id as string,
      };
    }
    return;
  } catch {
    return;
  }
}

async function getSlackWebClient(): Promise<WebClient> {
  // First try environment variable
  if (config.SLACK_BOT_TOKEN) {
    return new WebClient(config.SLACK_BOT_TOKEN);
  }

  // Then try stored token
  const token = await getToken('slack');
  if (!token) {
    throw new Error(
      'User not authenticated. Please run "pnpm start login slack" first.'
    );
  }

  return new WebClient(token);
}

async function findSlackChannelByName(
  slack: WebClient,
  channelName: string
): Promise<SlackChannel | undefined> {
  try {
    const result = (await slack.conversations.list({
      types: 'public_channel,private_channel',
    })) as SlackConversationsListResponse;

    if (!(result.ok && result.channels)) {
      return;
    }

    return result.channels.find((channel) => channel.name === channelName);
  } catch {
    return;
  }
}

async function createSlackChannel(
  slack: WebClient,
  name: string,
  isPrivate: boolean
): Promise<SlackChannel> {
  const result = await slack.conversations.create({
    name,
    is_private: isPrivate,
  });

  if (!(result.ok && result.channel)) {
    throw new Error(`Failed to create channel: ${result.error}`);
  }

  return result.channel as SlackChannel;
}

async function resolveChannelIdByName(
  slack: WebClient,
  name: string
): Promise<string | undefined> {
  // Try to get channel info by name to get the actual ID
  try {
    const channelInfo = await slack.conversations.info({ channel: name });
    if (channelInfo.ok && channelInfo.channel?.id) {
      return channelInfo.channel.id;
    }
  } catch {
    // Fall through to next method
  }

  // Try alternative: search through conversations list with different parameters
  try {
    const conversationsList = await slack.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000, // Increase limit to find more channels
    });

    if (conversationsList.ok && conversationsList.channels) {
      const foundChannel = conversationsList.channels.find(
        (ch: any) => ch.name === name
      );
      if (foundChannel?.id) {
        return foundChannel.id;
      }
    }
  } catch {
    // Channel resolution failed
  }

  return;
}

async function findOrCreateSlackChannel(
  slack: WebClient,
  name: string,
  isPrivate: boolean
): Promise<SlackChannel> {
  // Check if 'name' is actually a Slack channel ID (starts with 'C')
  if (name.startsWith('C')) {
    return { id: name, name } as SlackChannel;
  }

  // First try to find existing channel
  let channel = await findSlackChannelByName(slack, name);

  if (!channel) {
    // Try to create new channel if not found
    try {
      channel = await createSlackChannel(slack, name, isPrivate);
    } catch (error: any) {
      // If channel creation fails with 'name_taken', the channel exists but we couldn't find it
      if (
        error.code === 'slack_webapi_platform_error' &&
        error.data?.error === 'name_taken'
      ) {
        const resolvedId = await resolveChannelIdByName(slack, name);
        if (resolvedId) {
          return { id: resolvedId, name } as SlackChannel;
        }
        return { id: name, name } as SlackChannel;
      }
      throw error;
    }
  }

  return channel;
}

async function uploadAndPostMessageWithAttachments(
  slack: WebClient,
  channelId: string,
  messageText: string,
  attachments: SlackImportAttachment[],
  threadTs: string | undefined,
  logger: Logger
): Promise<string | undefined> {
  try {
    // Step 1: Get upload URLs for all files
    const uploadPromises = attachments.map(async (attachment) => {
      const fileContent = await readFile(attachment.local_path);
      const uploadUrlResult = await slack.files.getUploadURLExternal({
        filename: attachment.filename,
        length: fileContent.length,
        alt_text: attachment.alt_text,
      });

      if (
        !(
          uploadUrlResult.ok &&
          uploadUrlResult.upload_url &&
          uploadUrlResult.file_id
        )
      ) {
        throw new Error(
          `Failed to get upload URL for ${attachment.filename}: ${uploadUrlResult.error}`
        );
      }

      return {
        attachment,
        fileContent,
        uploadUrl: uploadUrlResult.upload_url,
        fileId: uploadUrlResult.file_id,
      };
    });

    const uploadData = await Promise.all(uploadPromises);

    // Step 2: Upload all files to their URLs
    const fileUploadPromises = uploadData.map(
      async ({ fileContent, uploadUrl, attachment }) => {
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          body: fileContent as BodyInit,
        });

        if (!uploadResponse.ok) {
          throw new Error(
            `File upload failed for ${attachment.filename}: ${uploadResponse.statusText}`
          );
        }
      }
    );

    await Promise.all(fileUploadPromises);

    // Step 3: Complete the upload and post message with attachments
    const completeParams: any = {
      files: uploadData.map(({ fileId, attachment }) => ({
        id: fileId,
        title: attachment.title || attachment.filename,
      })),
      channel_id: channelId,
      initial_comment: messageText,
    };

    if (threadTs) {
      completeParams.thread_ts = threadTs;
    }

    const completeResult =
      await slack.files.completeUploadExternal(completeParams);

    if (!completeResult.ok) {
      throw new Error(`Failed to complete upload: ${completeResult.error}`);
    }

    return (completeResult as any).ts;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.addWarning(
      'file_upload',
      `${attachments.length} attachments`,
      `Failed to upload attachments: ${errorMessage}`
    );
    return;
  }
}

async function postTextMessage(
  slack: WebClient,
  channelId: string,
  messageText: string,
  threadTs: string | undefined
): Promise<string> {
  const messageArgs: SlackMessageArgs = {
    channel: channelId,
    text: messageText,
  };

  if (threadTs) {
    messageArgs.thread_ts = threadTs;
  }

  const result = await slack.chat.postMessage(messageArgs);

  if (!result.ok) {
    throw new Error(`Failed to post message: ${result.error}`);
  }

  return result.ts as string;
}

async function addReactionsToMessage(
  slack: WebClient,
  channelId: string,
  messageTs: string,
  reactions: { name: string }[],
  logger: Logger
): Promise<void> {
  const reactionPromises = reactions.map(async (reaction) => {
    try {
      await slack.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: reaction.name,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.addWarning(
        'reaction_add',
        `${reaction.name} on message`,
        errorMessage
      );
    }
  });

  await Promise.all(reactionPromises);
}

async function postSlackMessage(
  slack: WebClient,
  channelId: string,
  message: SlackImportMessage,
  logger: Logger
): Promise<string | undefined> {
  try {
    const timestampText = message.timestamp
      ? ` at _${new Date(message.timestamp).toLocaleString()}_`
      : '';
    const senderName = message.display_name || 'Unknown User';
    const messageText = `*${senderName}*${timestampText}\n\n${message.text || ''}`;

    // Try to post with attachments first, fall back to text-only if attachments fail
    const messageTs = message.attachments?.length
      ? (await uploadAndPostMessageWithAttachments(
          slack,
          channelId,
          messageText,
          message.attachments,
          message.thread_ts,
          logger
        )) ||
        (await postTextMessage(
          slack,
          channelId,
          messageText,
          message.thread_ts
        ))
      : await postTextMessage(slack, channelId, messageText, message.thread_ts);

    // Add reactions if present
    if (message.reactions?.length && messageTs) {
      await addReactionsToMessage(
        slack,
        channelId,
        messageTs,
        message.reactions,
        logger
      );
    }

    return messageTs;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.addError(
      'message_post',
      message.display_name || 'Unknown User',
      errorMessage
    );
    return;
  }
}

async function performDryRun(slack: WebClient): Promise<void> {
  console.log('[Dry Run] Testing Slack API connection...');

  const testChannelName = `chat-migrator-test-${Date.now()}`;

  try {
    // Create test channel with unique name
    const testChannel = await createSlackChannel(slack, testChannelName, false);
    console.log(`[Dry Run] Created test channel: #${testChannelName}`);

    // Post test message
    const testResult = await slack.chat.postMessage({
      channel: testChannel.id,
      text: 'Test message from chat-migrator - this will be deleted',
    });

    if (testResult.ok) {
      console.log('[Dry Run] Successfully posted test message');
    }

    // Clean up: delete the channel
    await slack.conversations.archive({ channel: testChannel.id });
    console.log('[Dry Run] Cleaned up test channel');

    console.log('[Dry Run] ✅ Slack API connection test successful!');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Dry Run] ❌ Connection test failed: ${errorMessage}`);
    throw error;
  }
}

// Removed UserInfo interface - no longer needed

// Removed buildUserMaps - display names are now included directly in messages

async function processChannel(
  slack: WebClient,
  channelData: {
    name: string;
    is_private: boolean;
    messages: SlackImportMessage[];
  },
  targetChannel: string | undefined,
  logger: Logger
): Promise<void> {
  const channelName = targetChannel || channelData.name;

  console.log(`\nProcessing channel: #${channelName}`);

  // Find or create channel
  const channel = await findOrCreateSlackChannel(
    slack,
    channelName,
    channelData.is_private
  );

  // Process messages with progress bar
  const progressBar = new ProgressBar(
    channelData.messages.length,
    `Importing messages to #${channel.name}`
  );

  // Map threadId to first message's Slack timestamp for threading
  const threadMap = new Map<string, string>();
  let processedCount = 0;

  for (const message of channelData.messages) {
    let threadTs: string | undefined;

    // Check if this message belongs to a thread
    if (message.threadId) {
      threadTs = threadMap.get(message.threadId);
    }

    // Post message with thread_ts if it's a reply
    const messageWithThread = { ...message, thread_ts: threadTs };

    // biome-ignore lint/nursery/noAwaitInLoop: Messages must be processed sequentially to preserve order and threading
    const messageTs = await postSlackMessage(
      slack,
      channel.id,
      messageWithThread,
      logger
    );

    // If this is the first message in a thread, save its Slack timestamp
    if (messageTs && message.threadId && !threadMap.has(message.threadId)) {
      threadMap.set(message.threadId, messageTs);
    }

    processedCount++;
    progressBar.update(processedCount);
  }

  progressBar.finish();
}

function displayImportSummary(
  importData: SlackImportData,
  logger: Logger
): void {
  console.log('\n📊 Import Summary:');
  console.log(`   Channels: ${importData.channels.length} processed`);

  const totalMessages = importData.channels.reduce(
    (sum, channel) => sum + channel.messages.length,
    0
  );
  console.log(`   Messages: ${totalMessages} imported`);

  const errorCount = logger.getErrorCount();
  const warningCount = logger.getWarningCount();

  if (errorCount > 0 || warningCount > 0) {
    if (errorCount > 0) {
      console.log(`🚨 ${errorCount} error(s) occurred during import`);
    }
    if (warningCount > 0) {
      console.log(`⚠️  ${warningCount} warning(s) occurred during import`);
    }
  } else {
    console.log('\n✅ Import completed successfully with no issues');
  }
}

// Export functions (following Declaration Before Use principle - exports at bottom)

export async function loginToSlack(): Promise<void> {
  console.log('🔐 Setting up Slack authentication...\n');

  // Check if token is provided via environment variable
  if (config.SLACK_BOT_TOKEN) {
    console.log('✅ Found SLACK_BOT_TOKEN in environment variables');
    await setToken('slack', config.SLACK_BOT_TOKEN);

    // Test the token
    const authResult = await testSlackToken(config.SLACK_BOT_TOKEN);
    if (authResult) {
      console.log(
        `✅ Successfully authenticated to Slack workspace: ${authResult.team}`
      );
      console.log(`   Bot user: ${authResult.user} (${authResult.user_id})`);
      return;
    } else {
      console.error('❌ Invalid SLACK_BOT_TOKEN provided');
      throw new Error('Invalid Slack bot token');
    }
  }

  // Check if token is already stored
  const existingToken = await getToken('slack');
  if (existingToken) {
    const authResult = await testSlackToken(existingToken);
    if (authResult) {
      console.log(
        `✅ Already authenticated to Slack workspace: ${authResult.team}`
      );
      return;
    }
    // Token is invalid, continue with setup instructions
  }

  // Provide setup instructions
  console.log('📋 Slack Bot Token Setup Required:\n');
  console.log('1. Create a Slack App:');
  console.log('   • Go to https://api.slack.com/apps');
  console.log('   • Click "Create New App" → "From scratch"');
  console.log('   • Enter app name and select your workspace\n');

  console.log('2. Configure Bot Permissions:');
  console.log('   • Go to "OAuth & Permissions" in the sidebar');
  console.log(
    '   • Under "Scopes" → "Bot Token Scopes", add these permissions:'
  );
  console.log('     - chat:write (Send messages)');
  console.log('     - files:write (Upload files)');
  console.log('     - channels:read (View channels)');
  console.log('     - channels:manage (Create channels)');
  console.log('     - reactions:write (Add emoji reactions)\n');

  console.log('3. Install the App:');
  console.log('   • Click "Install to Workspace" at the top');
  console.log('   • Review permissions and click "Allow"\n');

  console.log('4. Get Your Bot Token:');
  console.log('   • Copy the "Bot User OAuth Token" (starts with xoxb-)');
  console.log(
    '   • Add it to your .env file: SLACK_BOT_TOKEN=xoxb-your-token-here'
  );
  console.log('   • Or run: export SLACK_BOT_TOKEN=xoxb-your-token-here\n');

  console.log('5. Run the login command again:');
  console.log('   pnpm start login slack\n');

  throw new Error(
    'Slack bot token setup required. Please follow the instructions above.'
  );
}

export async function importSlackData(
  inputPath: string,
  targetChannel?: string,
  options: ImportOptions = {}
): Promise<void> {
  const { dryRun = false } = options;
  const logger = new Logger('Import');
  const slack = await getSlackWebClient();

  console.log(
    `${dryRun ? '[Dry Run] ' : ''}Starting Slack import from ${inputPath}`
  );

  // Load import data
  const importDataPath = path.join(inputPath, 'import.json');
  const importData: SlackImportData = JSON.parse(
    await readFile(importDataPath, 'utf-8')
  );

  if (dryRun) {
    await performDryRun(slack);
    return;
  }

  // Process each channel
  for (const channelData of importData.channels) {
    // biome-ignore lint/nursery/noAwaitInLoop: Channels must be processed sequentially to manage rate limits properly
    await processChannel(slack, channelData, targetChannel, logger);
  }

  // Display summary
  displayImportSummary(importData, logger);

  if (logger.hasIssues()) {
    const logPath = await logger.writeLog();
    console.log(`   Details: ${logPath}`);
  }
}
