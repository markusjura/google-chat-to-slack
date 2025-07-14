// Based on the Google Chat API documentation
// https://developers.google.com/chat/api/reference/rest/v1/spaces

export interface Space {
  name: string;
  displayName: string;
  spaceType: 'SPACE' | 'DM';
}

export interface Message {
  name: string;
  creator: User;
  createTime: string;
  text: string;
  thread?: {
    name: string;
  };
  attachments?: Attachment[];
}

export interface User {
  name: string;
  displayName: string;
  type: 'HUMAN' | 'BOT';
  email?: string; // Not always present
}

export interface Attachment {
  name: string;
  contentType: string;
  downloadUri: string;
}

export interface ListSpacesResponse {
  spaces: Space[];
  nextPageToken?: string;
}

export interface ListMessagesResponse {
  messages: Message[];
  nextPageToken?: string;
}
