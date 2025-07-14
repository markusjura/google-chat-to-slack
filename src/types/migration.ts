import { z } from 'zod';

export const UserSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  email: z.string().email().optional(),
  type: z.string(),
});

export const AttachmentSchema = z.object({
  name: z.string(),
  contentType: z.string(),
  downloadUrl: z.string().url(),
  localPath: z.string(),
});

export const MessageSchema = z.object({
  name: z.string(),
  creator: z.string(),
  createTime: z.string(),
  text: z.string(),
  thread: z
    .object({
      name: z.string(),
    })
    .nullable(),
  attachments: z.array(AttachmentSchema),
});

export const SpaceSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  spaceType: z.string(),
  messages: z.array(MessageSchema),
});

export const MigrationDataSchema = z.object({
  export_timestamp: z.string().datetime(),
  users: z.array(UserSchema),
  spaces: z.array(SpaceSchema),
});

export type User = z.infer<typeof UserSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Space = z.infer<typeof SpaceSchema>;
export type MigrationData = z.infer<typeof MigrationDataSchema>;
