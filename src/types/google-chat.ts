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
  lastUpdateTime?: string;
  text: string;
  formattedText?: string;
  thread?: {
    name: string;
  };
  space: {
    name: string;
  };
  attachments?: GoogleAttachment[];
  attachedGifs?: AttachedGif[];
  emojiReactionSummaries?: EmojiReactionSummary[];
  annotations?: Annotation[];
}

export interface User {
  name: string;
  type: 'HUMAN' | 'BOT';
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

export interface GoogleAttachment {
  name: string;
  contentName: string;
  contentType: string;
  downloadUri: string;
  thumbnailUri: string;
  source: 'DRIVE_FILE' | 'UPLOADED_CONTENT';
  resourceName: string;
}

export interface AttachedGif {
  uri: string;
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
