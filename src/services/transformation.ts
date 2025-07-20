import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GoogleMessage, Space, User } from '../types/google-chat';
import type {
  ChannelMapping,
  SlackImportAttachment,
  SlackImportChannel,
  SlackImportData,
  SlackImportMessage,
  UserMapping,
} from '../types/slack';

interface TransformOptions {
  dryRun?: boolean;
}

interface TransformStats {
  channels: number;
  messages: number;
  users: number;
  attachments: number;
  avatars: number;
  threads: number;
  reactions: number;
  mentions: number;
}

interface GoogleChatExportData {
  export_timestamp: string;
  spaces: Array<Space & { messages: GoogleMessage[] }>;
}

export async function transformGoogleChatToSlack(
  inputDir: string,
  outputDir: string,
  options: TransformOptions = {}
): Promise<void> {
  const { dryRun = false } = options;
  const stats = initializeStats();

  console.log(
    `${dryRun ? '[Dry Run] ' : ''}Transforming Google Chat export to Slack format...`
  );

  const exportData = await loadExportData(inputDir);
  const { users, userMappings } = prepareUserData(exportData.spaces);
  stats.users = users.length;

  const { channels } = await processChannels(
    exportData.spaces,
    userMappings,
    inputDir,
    outputDir,
    dryRun,
    stats
  );

  stats.avatars = await processAvatars(inputDir, outputDir, users, dryRun);

  const slackImportData = createSlackImportData(
    exportData.export_timestamp,
    channels,
    userMappings,
    users
  );

  await writeOutput(slackImportData, outputDir, dryRun);
  printStatistics(stats);
}

function initializeStats(): TransformStats {
  return {
    channels: 0,
    messages: 0,
    users: 0,
    attachments: 0,
    avatars: 0,
    threads: 0,
    reactions: 0,
    mentions: 0,
  };
}

async function loadExportData(inputDir: string): Promise<GoogleChatExportData> {
  const exportPath = path.join(inputDir, 'export.json');
  return JSON.parse(await readFile(exportPath, 'utf-8'));
}

function prepareUserData(spaces: Array<Space & { messages: GoogleMessage[] }>) {
  const users = extractUniqueUsers(spaces);
  const userMappings = createUserMappings(users);
  return { users, userMappings };
}

async function processChannels(
  spaces: Array<Space & { messages: GoogleMessage[] }>,
  userMappings: UserMapping[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean,
  stats: TransformStats
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
        dryRun
      );
      return { channelMapping, slackChannel };
    })
  );

  for (const { channelMapping, slackChannel } of transformedChannels) {
    channelMappings.push(channelMapping);
    channels.push(slackChannel);

    stats.channels++;
    stats.messages += slackChannel.messages.length;

    for (const message of slackChannel.messages) {
      if (message.thread_ts) {
        stats.threads++;
      }
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
  }

  return { channels, channelMappings };
}

async function processAvatars(
  inputDir: string,
  outputDir: string,
  users: User[],
  dryRun: boolean
): Promise<number> {
  if (dryRun) {
    return users.filter((u) => u.avatarUrl).length;
  }
  return await copyAvatarFiles(inputDir, outputDir, users);
}

function createSlackImportData(
  exportTimestamp: string,
  channels: SlackImportChannel[],
  userMappings: UserMapping[],
  users: User[]
): SlackImportData {
  return {
    export_timestamp: exportTimestamp,
    channels,
    users: userMappings.map((mapping) => ({
      email: mapping.google_chat_email,
      display_name: mapping.display_name,
      real_name: mapping.display_name,
      avatar_local_path: users.find(
        (u) => u.email === mapping.google_chat_email
      )?.avatarUrl,
    })),
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

function printStatistics(stats: TransformStats): void {
  console.log('\n📊 Transformation Statistics:');
  console.log(`Channels: ${stats.channels}`);
  console.log(`Messages: ${stats.messages}`);
  console.log(`Users: ${stats.users}`);
  console.log(`Attachments: ${stats.attachments}`);
  console.log(`Avatars: ${stats.avatars}`);
  console.log(`Threaded messages: ${stats.threads}`);
  console.log(`Reactions: ${stats.reactions}`);
  console.log(`User mentions: ${stats.mentions}`);
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
    const key = message.sender.email?.trim() || message.sender.name;
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
      const key = user.email?.trim() || user.name;
      if (key) {
        userMap.set(key, user);
      }
    }
  }
}

function isUserMention(annotation: any): boolean {
  return annotation.type === 'USER_MENTION' && annotation.userMention?.user;
}

function createUserMappings(users: User[]): UserMapping[] {
  return users.map((user) => {
    // Use real email if available, otherwise generate one
    let email = user.email?.trim();
    if (!email) {
      if (user.displayName) {
        email = `${user.displayName.toLowerCase().replace(/\s+/g, '.')}@google-chat.imported`;
      } else {
        const userId = user.name.replace('people/', '');
        email = `user.${userId}@google-chat.imported`;
      }
    }

    return {
      google_chat_id: user.name,
      google_chat_email: email,
      display_name: user.displayName || email.split('@')[0],
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
  dryRun: boolean
): Promise<SlackImportChannel> {
  const sortedMessages = sortMessagesByTime(space.messages);
  const threadMap = new Map<string, string>();

  const slackMessages = await transformMessages(
    sortedMessages,
    userMappings,
    inputDir,
    outputDir,
    dryRun,
    threadMap
  );

  return createSlackChannel(space, slackMessages);
}

function sortMessagesByTime(messages: GoogleMessage[]): GoogleMessage[] {
  return messages.sort(
    (a, b) =>
      new Date(a.createTime).getTime() - new Date(b.createTime).getTime()
  );
}

async function transformMessages(
  messages: GoogleMessage[],
  userMappings: UserMapping[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean,
  threadMap: Map<string, string>
): Promise<SlackImportMessage[]> {
  const messagePromises = messages.map((message) => {
    return transformSingleMessage(
      message,
      userMappings,
      inputDir,
      outputDir,
      dryRun,
      threadMap
    );
  });

  const results = await Promise.all(messagePromises);
  return results.filter(Boolean) as SlackImportMessage[];
}

async function transformSingleMessage(
  message: GoogleMessage,
  userMappings: UserMapping[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean,
  threadMap: Map<string, string>
): Promise<SlackImportMessage | null> {
  const userEmail = getUserEmail(message.sender, userMappings);
  if (!userEmail) {
    return null;
  }

  const threadTs = getThreadTimestamp(message, threadMap);

  const [attachments, reactions, mentions] = await Promise.all([
    transformAttachments(
      message.attachments || message.attachment || [],
      inputDir,
      outputDir,
      dryRun
    ),
    Promise.resolve(transformReactions(message.emojiReactionSummaries || [])),
    Promise.resolve(transformMentions(message.annotations || [], userMappings)),
  ]);

  return {
    text: message.text || message.formattedText || '',
    user_email: userEmail,
    timestamp: message.createTime,
    thread_ts: threadTs,
    attachments: attachments.length > 0 ? attachments : undefined,
    reactions: reactions.length > 0 ? reactions : undefined,
    mentions: mentions.length > 0 ? mentions : undefined,
  };
}

function getThreadTimestamp(
  message: GoogleMessage,
  threadMap: Map<string, string>
): string | undefined {
  if (!message.thread) {
    return;
  }

  if (threadMap.has(message.thread.name)) {
    return threadMap.get(message.thread.name);
  }

  threadMap.set(message.thread.name, message.createTime);
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

function getUserEmail(
  sender: User,
  userMappings: UserMapping[]
): string | null {
  if (sender?.email?.trim()) {
    return sender.email;
  }

  // Fallback: try to find by Google Chat ID
  const mapping = userMappings.find((m) => m.google_chat_id === sender?.name);
  if (mapping?.google_chat_email) {
    return mapping.google_chat_email;
  }

  // Last resort: generate email from display name or user ID
  if (sender?.displayName) {
    return `${sender.displayName.toLowerCase().replace(/\s+/g, '.')}@google-chat.imported`;
  }
  if (sender?.name) {
    const userId = sender.name.replace('people/', '');
    return `user.${userId}@google-chat.imported`;
  }

  return null;
}

async function transformAttachments(
  googleAttachments: any[],
  inputDir: string,
  outputDir: string,
  dryRun: boolean
): Promise<SlackImportAttachment[]> {
  const validAttachments = googleAttachments.filter(
    (attachment) =>
      (attachment.localFilePath || attachment.contentName) &&
      attachment.contentType
  );

  if (!dryRun && validAttachments.length > 0) {
    const destDir = path.join(outputDir, 'attachments');
    await mkdir(destDir, { recursive: true });
  }

  const attachmentPromises = validAttachments.map(async (attachment) => {
    // Use localFilePath if available, fallback to contentName for backward compatibility
    const sourceFileName = attachment.localFilePath
      ? path.basename(attachment.localFilePath)
      : attachment.contentName;

    const sourceFile = path.join(inputDir, 'attachments', sourceFileName);
    const destFile = path.join(outputDir, 'attachments', sourceFileName);

    if (!dryRun) {
      try {
        await copyFile(sourceFile, destFile);
      } catch {
        console.warn(`Could not copy attachment: ${sourceFileName}`);
        return null;
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

function transformReactions(
  googleReactions: any[]
): Array<{ name: string; count: number; users: string[] }> {
  return googleReactions.map((reaction) => ({
    name: reaction.emoji?.unicode || '👍',
    count: reaction.reactionCount || 1,
    users: [],
  }));
}

function transformMentions(
  googleAnnotations: any[],
  userMappings: UserMapping[]
): Array<{ user_email: string; display_name: string }> {
  return googleAnnotations
    .filter((annotation) => annotation.type === 'USER_MENTION')
    .map((annotation) => {
      const mentionedUser = annotation.userMention?.user;
      const mapping = userMappings.find(
        (m) =>
          m.google_chat_id === mentionedUser?.name ||
          m.google_chat_email === mentionedUser?.email
      );

      return mapping
        ? {
            user_email: mapping.google_chat_email,
            display_name: mapping.display_name,
          }
        : null;
    })
    .filter(Boolean) as Array<{ user_email: string; display_name: string }>;
}

async function copyAvatarFiles(
  inputDir: string,
  outputDir: string,
  users: User[]
): Promise<number> {
  const avatarsInputDir = path.join(inputDir, 'avatars');
  const avatarsOutputDir = path.join(outputDir, 'avatars');

  await mkdir(avatarsOutputDir, { recursive: true });

  const usersWithAvatars = users.filter((user) => user.avatarUrl);

  const copyPromises = usersWithAvatars.map(async (user) => {
    try {
      const filename = path.basename(user.avatarUrl as string);
      const sourceFile = path.join(avatarsInputDir, filename);
      const destFile = path.join(avatarsOutputDir, filename);

      await copyFile(sourceFile, destFile);
      return true;
    } catch {
      console.warn(
        `Could not copy avatar for user: ${user.displayName || user.email}`
      );
      return false;
    }
  });

  const results = await Promise.all(copyPromises);
  return results.filter(Boolean).length;
}
