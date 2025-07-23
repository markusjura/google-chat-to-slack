import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ExportData,
  GoogleMessage,
  Space,
  User,
} from '../types/google-chat';
import type {
  ChannelMapping,
  SlackImportAttachment,
  SlackImportChannel,
  SlackImportData,
  SlackImportMessage,
  UserMapping,
} from '../types/slack';
import { Logger } from '../utils/logger';

interface TransformOptions {
  dryRun?: boolean;
}

interface TransformStats {
  channels: number;
  messages: number;
  users: number;
  attachments: number;
  threads: number;
  reactions: number;
  mentions: number;
}

export async function transformGoogleChatToSlack(
  inputDir: string,
  outputDir: string,
  options: TransformOptions = {}
): Promise<void> {
  const { dryRun = false } = options;
  const stats = initializeStats();
  const logger = new Logger();

  console.log(
    `${dryRun ? '[Dry Run] ' : ''}Transforming Google Chat export to Slack format...`
  );

  const exportData = await loadExportData(inputDir);
  const { users, userMappings } = prepareUserData(
    exportData.spaces,
    exportData.users
  );
  stats.users = users.length;

  const { channels } = await processChannels(
    exportData.spaces,
    userMappings,
    inputDir,
    outputDir,
    dryRun,
    stats,
    logger
  );

  const slackImportData = createSlackImportData(
    exportData.export_timestamp,
    channels
  );

  await writeOutput(slackImportData, outputDir, dryRun);
  await displayTransformationSummary(stats, logger, dryRun);
}

function initializeStats(): TransformStats {
  return {
    channels: 0,
    messages: 0,
    users: 0,
    attachments: 0,
    threads: 0,
    reactions: 0,
    mentions: 0,
  };
}

async function loadExportData(inputDir: string): Promise<ExportData> {
  const exportPath = path.join(inputDir, 'export.json');
  return JSON.parse(await readFile(exportPath, 'utf-8'));
}

function prepareUserData(
  spaces: Array<Space & { messages: GoogleMessage[] }>,
  usersNameMap: Record<string, string>
) {
  const users = extractUniqueUsers(spaces);
  const userMappings = createUserMappings(users, usersNameMap);
  return { users, userMappings };
}

async function processChannels(
  spaces: Array<Space & { messages: GoogleMessage[] }>,
  userMappings: UserMapping[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean,
  stats: TransformStats,
  logger: Logger
) {
  const channels: SlackImportChannel[] = [];
  const channelMappings: ChannelMapping[] = [];

  const transformedChannels = await Promise.all(
    spaces.map(async (space) => {
      const channelMapping = createChannelMapping(space);
      const slackChannel = await transformChannel(
        space,
        userMappings,
        inputDir,
        outputDir,
        dryRun,
        logger
      );
      return { channelMapping, slackChannel };
    })
  );

  for (const { channelMapping, slackChannel } of transformedChannels) {
    channelMappings.push(channelMapping);
    channels.push(slackChannel);

    stats.channels++;
    updateStatsForChannel(slackChannel, stats);
  }

  return { channels, channelMappings };
}

function updateStatsForChannel(
  slackChannel: SlackImportChannel,
  stats: TransformStats
): void {
  // Count all messages (no nesting anymore)
  for (const message of slackChannel.messages) {
    stats.messages++; // Count each message

    if (message.threadId) {
      stats.threads++;
    }

    updateStatsForMessage(message, stats);
  }
}

function updateStatsForMessage(
  message: SlackImportMessage,
  stats: TransformStats
): void {
  if (message.attachments) {
    stats.attachments += message.attachments.length;
  }
  if (message.reactions) {
    stats.reactions += message.reactions.length;
  }
  if (message.mentions) {
    stats.mentions += message.mentions.length;
  }
}

function createSlackImportData(
  exportTimestamp: string,
  channels: SlackImportChannel[]
): SlackImportData {
  return {
    export_timestamp: exportTimestamp,
    channels,
  };
}

async function writeOutput(
  slackImportData: SlackImportData,
  outputDir: string,
  dryRun: boolean
): Promise<void> {
  if (!dryRun) {
    const outputPath = path.join(outputDir, 'import.json');
    await writeFile(outputPath, JSON.stringify(slackImportData, null, 2));
    console.log(`Transformation complete. Output saved to: ${outputPath}`);
  }
}

async function displayTransformationSummary(
  stats: TransformStats,
  logger: Logger,
  isDryRun: boolean
): Promise<void> {
  console.log('\n📊 Transformation Summary:');
  console.log(`   Channels: ${stats.channels} converted`);
  console.log(`   Messages: ${stats.messages} processed`);
  console.log(`   Users: ${stats.users} mapped`);

  if (stats.attachments > 0) {
    console.log(`   Attachments: ${stats.attachments} processed`);
  }

  if (stats.threads > 0) {
    console.log(`   • Threaded messages: ${stats.threads}`);
  }

  if (stats.reactions > 0) {
    console.log(`   • Reactions: ${stats.reactions}`);
  }

  if (stats.mentions > 0) {
    console.log(`   • User mentions: ${stats.mentions}`);
  }

  const errorCount = logger.getErrorCount();
  const warningCount = logger.getWarningCount();

  if (errorCount > 0 || warningCount > 0) {
    console.log('');
    if (errorCount > 0) {
      console.log(`🚨 ${errorCount} error(s) occurred during transformation`);
    }
    if (warningCount > 0) {
      console.log(
        `⚠️  ${warningCount} warning(s) occurred during transformation`
      );
    }

    let logPath = '';
    if (logger.hasIssues() && !isDryRun) {
      logPath = await logger.writeLog();
      console.log(`   Details: ${logPath}`);
    }
  } else if (!isDryRun) {
    console.log(`\n✅ Transformation completed successfully with no issues`);
  }
}

function extractUniqueUsers(
  spaces: Array<Space & { messages: GoogleMessage[] }>
): User[] {
  const userMap = new Map<string, User>();

  for (const space of spaces) {
    processSpaceUsers(space, userMap);
  }

  return Array.from(userMap.values());
}

function processSpaceUsers(
  space: Space & { messages: GoogleMessage[] },
  userMap: Map<string, User>
): void {
  for (const message of space.messages) {
    processMessageSender(message, userMap);
    processMessageMentions(message, userMap);
  }
}

function processMessageSender(
  message: GoogleMessage,
  userMap: Map<string, User>
): void {
  if (message.sender) {
    const key = message.sender.name;
    if (key) {
      userMap.set(key, message.sender);
    }
  }
}

function processMessageMentions(
  message: GoogleMessage,
  userMap: Map<string, User>
): void {
  if (!message.annotations) {
    return;
  }

  for (const annotation of message.annotations) {
    if (isUserMention(annotation)) {
      const user = annotation.userMention.user;
      const key = user.name;
      if (key) {
        userMap.set(key, user);
      }
    }
  }
}

function isUserMention(annotation: any): boolean {
  return annotation.type === 'USER_MENTION' && annotation.userMention?.user;
}

function createUserMappings(
  users: User[],
  usersNameMap: Record<string, string>
): UserMapping[] {
  return users.map((user) => {
    // Get display name from users mapping if available
    const fullDisplayName = usersNameMap[user.name] || user.name;

    return {
      google_chat_id: user.name,
      display_name: fullDisplayName,
    };
  });
}

function createChannelMapping(space: Space): ChannelMapping {
  return {
    google_chat_space_id: space.name,
    google_chat_display_name: space.displayName,
    slack_channel_name: normalizeChannelName(space.displayName),
    is_private: space.spaceType === 'DM' || space.spaceType === 'SPACE', // Assume SPACE can be private
  };
}

function normalizeChannelName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/-+/g, '-') // Replace multiple consecutive hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 80); // Slack limit is 80 characters
}

async function transformChannel(
  space: Space & { messages: GoogleMessage[] },
  userMappings: UserMapping[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean,
  logger: Logger
): Promise<SlackImportChannel> {
  const slackMessages = await transformMessages(
    space.messages,
    userMappings,
    inputDir,
    outputDir,
    dryRun,
    logger
  );

  return createSlackChannel(space, slackMessages);
}

async function transformMessages(
  messages: GoogleMessage[],
  userMappings: UserMapping[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean,
  logger: Logger
): Promise<SlackImportMessage[]> {
  const messagePromises = messages.map((message) =>
    transformMessage(message, userMappings, inputDir, outputDir, dryRun, logger)
  );

  const transformedMessages = await Promise.all(messagePromises);
  return transformedMessages.filter(Boolean) as SlackImportMessage[];
}

async function transformMessage(
  message: GoogleMessage,
  userMappings: UserMapping[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean,
  logger: Logger
): Promise<SlackImportMessage | undefined> {
  // Get display name for this message
  const displayName = getDisplayName(message.sender, userMappings);
  if (!displayName || displayName === 'Unknown User') {
    return;
  }

  // Get threadId from Google Chat thread.name
  const threadId = message.thread?.name;

  const [attachments, reactions, mentions] = await Promise.all([
    transformAttachments(
      message.attachment || [],
      inputDir,
      outputDir,
      dryRun,
      logger
    ),
    Promise.resolve(transformReactions(message.emojiReactionSummaries || [])),
    Promise.resolve(transformMentions(message.annotations || [], userMappings)),
  ]);

  return {
    text: message.text,
    display_name: displayName,
    timestamp: message.createTime,
    threadId,
    attachments: attachments.length > 0 ? attachments : undefined,
    reactions: reactions.length > 0 ? reactions : undefined,
    mentions: mentions.length > 0 ? mentions : undefined,
  };
}

function createSlackChannel(
  space: Space,
  messages: SlackImportMessage[]
): SlackImportChannel {
  return {
    name: normalizeChannelName(space.displayName),
    is_private: space.spaceType === 'DM',
    topic: `Migrated from Google Chat space: ${space.displayName}`,
    purpose: `Chat history imported from Google Chat on ${new Date().toLocaleDateString()}`,
    messages,
  };
}

function getDisplayName(
  sender: User | undefined,
  userMappings: UserMapping[]
): string {
  if (!sender?.name) {
    return 'Unknown User';
  }

  // Find display name in mappings
  const mapping = userMappings.find((m) => m.google_chat_id === sender.name);
  return mapping?.display_name || sender.name;
}

async function transformAttachments(
  googleAttachments: any[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean,
  logger: Logger
): Promise<SlackImportAttachment[]> {
  const validAttachments = googleAttachments.filter(
    (attachment) => attachment.localFilePath && attachment.contentType
  );

  if (!dryRun && validAttachments.length > 0) {
    const destDir = path.join(outputDir, 'attachments');
    await mkdir(destDir, { recursive: true });
  }

  const attachmentPromises = validAttachments.map(async (attachment) => {
    // Only process attachments that were successfully downloaded (have localFilePath)
    const sourceFileName = path.basename(attachment.localFilePath);

    const sourceFile = path.join(inputDir, 'attachments', sourceFileName);
    const destFile = path.join(outputDir, 'attachments', sourceFileName);

    if (!dryRun) {
      try {
        await copyFile(sourceFile, destFile);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.addError(
          'file_copy',
          sourceFileName,
          `Failed to copy attachment: ${errorMessage}`
        );
        return;
      }
    }

    return {
      filename: sourceFileName,
      content_type: attachment.contentType,
      local_path: destFile,
      title: attachment.name || sourceFileName,
      alt_text: `Attachment: ${sourceFileName}`,
    };
  });

  const results = await Promise.all(attachmentPromises);
  return results.filter(Boolean) as SlackImportAttachment[];
}

function convertUnicodeEmojiToSlackName(unicodeEmoji: string): string {
  // Common emoji mappings from Unicode to Slack shortcodes
  const emojiMap: Record<string, string> = {
    '👍': '+1',
    '👎': '-1',
    '💡': 'bulb',
    '🙌': 'raised_hands',
    '❤️': 'heart',
    '😀': 'grinning',
    '😂': 'joy',
    '😍': 'heart_eyes',
    '😢': 'cry',
    '🔥': 'fire',
    '✅': 'white_check_mark',
    '❌': 'x',
    '⭐': 'star',
    '👏': 'clap',
    '🎉': 'tada',
    '🚀': 'rocket',
    '💯': '100',
    '🤔': 'thinking_face',
    '😅': 'sweat_smile',
    '😊': 'blush',
    '👌': 'ok_hand',
    '🙏': 'pray',
    '💪': 'muscle',
    '🎯': 'dart',
    '📝': 'memo',
    '⚡': 'zap',
    '🎊': 'confetti_ball',
  };

  // Return mapped shortcode or try using the Unicode directly (some work)
  return emojiMap[unicodeEmoji] || unicodeEmoji;
}

function transformReactions(
  googleReactions: any[]
): Array<{ name: string; count: number; users: string[] }> {
  return googleReactions.map((reaction) => {
    const unicodeEmoji = reaction.emoji?.unicode || '👍';
    const slackEmojiName = convertUnicodeEmojiToSlackName(unicodeEmoji);

    return {
      name: slackEmojiName,
      count: reaction.reactionCount || 1,
      users: [],
    };
  });
}

function transformMentions(
  googleAnnotations: any[],
  userMappings: UserMapping[]
): Array<{ display_name: string }> {
  return googleAnnotations
    .filter((annotation) => annotation.type === 'USER_MENTION')
    .map((annotation) => {
      const mentionedUser = annotation.userMention?.user;
      const mapping = userMappings.find(
        (m) => m.google_chat_id === mentionedUser?.name
      );

      return mapping
        ? {
            display_name: mapping.display_name,
          }
        : null;
    })
    .filter(Boolean) as Array<{ display_name: string }>;
}
