// Based on the Google Chat API documentation
// https://developers.google.com/chat/api/reference/rest/v1/spaces

export interface Space {
  name: string;
  displayName: string;
  spaceType: 'SPACE' | 'DM';
}

export interface GoogleMessage {
  name: string;
  sender: User;
  createTime: string;
  text: string;
  formattedText?: string;
  thread?: {
    name: string;
  };
  space: {
    name: string;
  };
  attachment?: GoogleAttachment[];
  emojiReactionSummaries?: EmojiReactionSummary[];
  annotations?: Annotation[];
  threadReply?: boolean; // When true, message is a response in reply thread; when false, it's a top-level message
}

export interface ExportData {
  export_timestamp: string;
  users: Record<string, string>; // Simple mapping: userId -> fullName
  spaces: (Space & { messages: GoogleMessage[] })[];
}

export interface User {
  name: string;
}

export interface GoogleAttachment {
  name: string;
  contentName?: string;
  contentType?: string;
  downloadUri?: string;
  source?: 'DRIVE_FILE' | 'UPLOADED_CONTENT';
  resourceName?: string;
  attachmentDataRef?: {
    resourceName: string;
  };
  driveDataRef?: {
    driveFileId: string;
  };
  // Local file path after download
  localFilePath?: string;
}

export interface EmojiReactionSummary {
  emoji: Emoji;
  reactionCount: number;
}

export interface Emoji {
  unicode: string;
}

export interface Annotation {
  type: 'USER_MENTION';
  startIndex: number;
  length: number;
  userMention: {
    user: User;
    type: 'ADD' | 'MENTION';
  };
}

export interface ListSpacesResponse {
  spaces: Space[];
  nextPageToken?: string;
}

export interface ListMessagesResponse {
  messages: GoogleMessage[];
  nextPageToken?: string;
}
