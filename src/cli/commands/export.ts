import type { CommandModule } from 'yargs';
import { listMessages, listSpaces } from '../../services/google-chat';
import * as fs from 'fs/promises';
import {
  MigrationData,
  Space,
  Message,
  User,
  Attachment,
} from '../../types/migration';
import {
  Space as GoogleSpace,
  Message as GoogleMessage,
  User as GoogleUser,
  Attachment as GoogleAttachment,
} from '../../types/google-chat';

type ExportArgs = {
  service: string;
  space: string | undefined;
  output: string;
  dryRun: boolean;
};

function transformUser(googleUser: GoogleUser): User {
  return {
    name: googleUser.name,
    displayName: googleUser.displayName,
    email: googleUser.email,
    type: googleUser.type,
  };
}

function transformAttachment(googleAttachment: GoogleAttachment): Attachment {
  // Placeholder for actual download logic
  const localPath = `attachments/${googleAttachment.name.split('/').pop()}`;
  return {
    name: googleAttachment.name,
    contentType: googleAttachment.contentType,
    downloadUrl: googleAttachment.downloadUri,
    localPath,
  };
}

function transformMessage(googleMessage: GoogleMessage): Message {
  const attachments = googleMessage.attachments
    ? googleMessage.attachments.map(transformAttachment)
    : [];
  return {
    name: googleMessage.name,
    creator: googleMessage.creator.name,
    createTime: googleMessage.createTime,
    text: googleMessage.text,
    thread: googleMessage.thread ? { name: googleMessage.thread.name } : null,
    attachments,
  };
}

async function transformSpace(googleSpace: GoogleSpace): Promise<Space> {
  const messages = await listMessages(googleSpace.name);
  const transformedMessages = messages.map(transformMessage);
  return {
    name: googleSpace.name,
    displayName: googleSpace.displayName,
    spaceType: googleSpace.spaceType,
    messages: transformedMessages,
  };
}

export const exportCommand: CommandModule<object, ExportArgs> = {
  command: 'export <service>',
  describe: 'Export data from a chat service',
  builder: (yargs) =>
    yargs
      .positional('service', {
        describe: 'The chat service to export from (e.g., google-chat)',
        type: 'string',
        demandOption: true,
      })
      .option('space', {
        alias: 's',
        describe:
          'The ID of the space to export. If not provided, all spaces will be exported.',
        type: 'string',
      })
      .option('output', {
        alias: 'o',
        describe: 'The path to the output JSON file.',
        type: 'string',
        demandOption: true,
      })
      .option('dry-run', {
        describe:
          'Test the connection and export a single space with a few messages.',
        type: 'boolean',
        default: false,
      }),
  handler: async (argv) => {
    if (argv.service !== 'google-chat') {
      console.error(`Unsupported service: ${argv.service}`);
      return;
    }

    if (argv.dryRun) {
      console.log('Performing a dry run...');
      try {
        const spaces = await listSpaces();
        if (spaces.length === 0) {
          console.log('No spaces found to export.');
          return;
        }
        const spaceToExport = spaces[0];
        const messages = await listMessages(spaceToExport.name);
        console.log(
          `Successfully connected to Google Chat. Found ${spaces.length} spaces.`
        );
        console.log(
          `Dry run complete. Would have exported 1 space with ${messages.length} messages.`
        );
      } catch (error) {
        console.error('Dry run failed:', error);
      }
      return;
    }

    console.log('Exporting from Google Chat...');

    try {
      const allSpaces = await listSpaces();
      let spacesToExport = allSpaces;

      if (argv.space) {
        const foundSpace = allSpaces.find((s) => s.name === argv.space);
        if (!foundSpace) {
          console.error(`Space "${argv.space}" not found.`);
          return;
        }
        spacesToExport = [foundSpace];
      }

      const transformedSpaces = await Promise.all(
        spacesToExport.map(transformSpace)
      );

      const allUsers = new Map<string, User>();
      const googleMessages = (
        await Promise.all(spacesToExport.map((s) => listMessages(s.name)))
      ).flat();
      for (const message of googleMessages) {
        if (!allUsers.has(message.creator.name)) {
          allUsers.set(message.creator.name, transformUser(message.creator));
        }
      }

      const migrationData: MigrationData = {
        export_timestamp: new Date().toISOString(),
        users: Array.from(allUsers.values()),
        spaces: transformedSpaces,
      };

      await fs.writeFile(argv.output, JSON.stringify(migrationData, null, 2));
      console.log(`Successfully exported data to ${argv.output}`);
    } catch (error) {
      console.error('An error occurred during export:', error);
    }
  },
};
