import { existsSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { CommandModule } from 'yargs';
import { exportGoogleChatData } from '../../services/google-chat';
import { importSlackData, loginToSlack } from '../../services/slack';
import { transformGoogleChatToSlack } from '../../services/transformation';

interface Args {
  channel?: string | string[];
  output?: string;
  'dry-run'?: boolean;
  'channel-prefix'?: string;
  'channel-rename'?: string | string[];
}

export const migrateCommand: CommandModule<object, Args> = {
  command: 'migrate',
  describe:
    'Complete migration: authenticate with both services, export from Google Chat, transform data, and import to Slack',
  builder: (yargs) => {
    return yargs
      .option('channel', {
        type: 'string',
        array: true,
        describe:
          'Name of specific Google Chat space(s) to migrate (can be used multiple times, if not specified, migrates all spaces)',
      })
      .option('output', {
        type: 'string',
        describe: 'Base output directory for migration data',
        default: 'data',
      })
      .option('dry-run', {
        type: 'boolean',
        describe:
          'Perform dry-run: minimal export, show transform stats, test Slack connection',
        default: false,
      })
      .option('channel-prefix', {
        type: 'string',
        describe: 'Prefix to add to channel names during Slack import',
      })
      .option('channel-rename', {
        type: 'string',
        array: true,
        describe:
          'Rename channels during import (format: old-name=new-name, can be used multiple times)',
      })
      .example('$0 migrate', 'Migrate all Google Chat spaces to Slack')
      .example(
        '$0 migrate --channel general',
        "Migrate only the 'general' space to 'general' Slack channel"
      )
      .example(
        '$0 migrate --channel general --channel team-updates',
        "Migrate only 'general' and 'team-updates' spaces"
      )
      .example('$0 migrate --dry-run', 'Test the complete migration pipeline')
      .example(
        '$0 migrate --channel-prefix "gchat-"',
        'Migrate with "gchat-" prefix (e.g., "general" → "gchat-general")'
      )
      .strict()
      .fail((msg, err, yargsInstance) => {
        if (msg) {
          console.error(`Error: ${msg}`);
          console.error('');
          yargsInstance.showHelp();
        } else if (err) {
          console.error(`Error: ${err.message}`);
        }
        process.exit(1);
      });
  },
  handler: async (args) => {
    try {
      const {
        channel,
        output = 'data',
        'dry-run': isDryRun,
        'channel-prefix': channelPrefix,
        'channel-rename': channelRename,
      } = args;

      const exportDir = path.join(output, 'export');
      const importDir = path.join(output, 'import');

      const startText = '🚀 MIGRATION START';
      console.log(startText);
      console.log('═'.repeat(startText.length));

      if (isDryRun) {
        console.log('📝 Running in dry-run mode');
        console.log('');
      }

      // Authentication Phase
      const authStageText = '🔐 AUTHENTICATION';
      console.log(authStageText);
      console.log('─'.repeat(authStageText.length));

      console.log(
        '✅ Google Chat authentication ready (assuming already logged in)'
      );

      console.log('📝 Authenticating with Slack...');
      await loginToSlack();
      console.log('✅ Slack authentication ready');
      console.log('');

      // Export
      const exportText = '📤 EXPORT';
      console.log(exportText);
      console.log('═'.repeat(exportText.length));

      // Clean and prepare export directory
      if (existsSync(exportDir)) {
        rmSync(exportDir, { recursive: true, force: true });
      }
      await mkdir(exportDir, { recursive: true });

      await exportGoogleChatData(channel, path.join(exportDir, 'export.json'), {
        dryRun: isDryRun,
      });

      console.log('✅ Export completed successfully');
      console.log('');

      // Transform data
      const transformText = '🔄 TRANSFORM';
      console.log(transformText);
      console.log('═'.repeat(transformText.length));

      // Clean and prepare import directory
      if (existsSync(importDir)) {
        rmSync(importDir, { recursive: true, force: true });
      }
      await mkdir(importDir, { recursive: true });

      await transformGoogleChatToSlack(exportDir, importDir, {
        dryRun: isDryRun,
      });

      console.log('✅ Transform completed successfully');
      console.log('');

      // Import
      const importText = '📥 IMPORT';
      console.log(importText);
      console.log('═'.repeat(importText.length));

      // We don't filter channels here. The export already contains only the channels we want to import.
      await importSlackData(importDir, undefined, {
        dryRun: isDryRun,
        channelPrefix,
        channelRename: channelRename as string[] | undefined,
      });

      console.log('✅ Import completed successfully');
      console.log('');

      // Final Summary
      const summaryText = '🎯 MIGRATION SUMMARY';
      console.log(summaryText);
      console.log('═'.repeat(summaryText.length));

      if (isDryRun) {
        console.log(
          '🎯 Dry-run completed! The migration pipeline is working correctly.'
        );
        console.log('✅ Both Google Chat and Slack are properly authenticated');
        console.log(
          '✅ Export, transform, and import services are all functional'
        );
        console.log(
          `💡 To run the actual migration, remove the --dry-run flag`
        );
      } else {
        console.log('🎉 Complete migration finished successfully!');
        console.log('✅ All data has been migrated from Google Chat to Slack');
        console.log(`📁 Migration data saved in: ${output}/`);
        console.log(`   • Export data: ${exportDir}/`);
        console.log(`   • Import data: ${importDir}/`);
        console.log('💡 You can now safely use your new Slack workspace!');
      }
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  },
};
