// Slack API types based on 2025 Web API
// References:
// - https://api.slack.com/apis/conversations-api
// - https://api.slack.com/methods/chat.postMessage
// - https://api.slack.com/methods/files.getUploadURLExternal
// - https://api.slack.com/methods/files.completeUploadExternal

export interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_im: boolean;
  is_mpim: boolean;
  is_private: boolean;
  created: number;
  is_archived: boolean;
  is_general: boolean;
  unlinked: number;
  name_normalized: string;
  is_shared: boolean;
  is_org_shared: boolean;
  is_member: boolean;
  is_pending_ext_shared: boolean;
  pending_shared: any[];
  context_team_id: string;
  updated: number;
  parent_conversation: string | null;
  creator: string;
  is_ext_shared: boolean;
  shared_team_ids: string[];
  pending_connected_team_ids: any[];
  is_pending_ext_shared_deprecated: boolean;
  topic: {
    value: string;
    creator: string;
    last_set: number;
  };
  purpose: {
    value: string;
    creator: string;
    last_set: number;
  };
}

export interface SlackUser {
  id: string;
  team_id: string;
  name: string;
  deleted: boolean;
  color?: string;
  real_name: string;
  tz?: string;
  tz_label?: string;
  tz_offset?: number;
  profile: {
    avatar_hash?: string;
    status_text?: string;
    status_emoji?: string;
    real_name: string;
    display_name: string;
    real_name_normalized: string;
    display_name_normalized: string;
    email: string;
    image_original?: string;
    image_24?: string;
    image_32?: string;
    image_48?: string;
    image_72?: string;
    image_192?: string;
    image_512?: string;
    team: string;
  };
  is_admin?: boolean;
  is_owner?: boolean;
  is_primary_owner?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_bot: boolean;
  is_app_user?: boolean;
  updated: number;
}

export interface SlackMessage {
  type: 'message';
  subtype?: string;
  ts: string;
  user: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  replies?: SlackThreadReply[];
  parent_user_id?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  files?: SlackFile[];
  reactions?: SlackReaction[];
  edited?: {
    user: string;
    ts: string;
  };
  client_msg_id?: string;
  team?: string;
  channel?: string;
  event_ts?: string;
  channel_team?: string;
  source_team?: string;
  user_team?: string;
}

export interface SlackThreadReply {
  user: string;
  ts: string;
}

export interface SlackFile {
  id: string;
  created: number;
  timestamp: number;
  name: string;
  title: string;
  mimetype: string;
  filetype: string;
  pretty_type: string;
  user: string;
  editable: boolean;
  size: number;
  mode: string;
  is_external: boolean;
  external_type: string;
  is_public: boolean;
  public_url_shared: boolean;
  display_as_bot: boolean;
  username: string;
  url_private: string;
  url_private_download: string;
  thumb_64?: string;
  thumb_80?: string;
  thumb_360?: string;
  thumb_360_w?: number;
  thumb_360_h?: number;
  thumb_480?: string;
  thumb_480_w?: number;
  thumb_480_h?: number;
  thumb_160?: string;
  thumb_720?: string;
  thumb_720_w?: number;
  thumb_720_h?: number;
  thumb_800?: string;
  thumb_800_w?: number;
  thumb_800_h?: number;
  thumb_960?: string;
  thumb_960_w?: number;
  thumb_960_h?: number;
  thumb_1024?: string;
  thumb_1024_w?: number;
  thumb_1024_h?: number;
  image_exif_rotation?: number;
  original_w?: number;
  original_h?: number;
  permalink: string;
  permalink_public: string;
  channels: string[];
  groups: string[];
  ims: string[];
  comments_count: number;
  initial_comment?: {
    id: string;
    created: number;
    timestamp: number;
    user: string;
    is_intro: boolean;
    comment: string;
  };
  shares?: {
    public?: {
      [channel_id: string]: SlackFileShare[];
    };
    private?: {
      [channel_id: string]: SlackFileShare[];
    };
  };
}

export interface SlackFileShare {
  reply_users: string[];
  reply_users_count: number;
  reply_count: number;
  ts: string;
  channel_name: string;
  team_id: string;
}

export interface SlackAttachment {
  service_name?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fallback?: string;
  image_url?: string;
  image_width?: number;
  image_height?: number;
  image_bytes?: number;
  thumb_url?: string;
  thumb_width?: number;
  thumb_height?: number;
  service_icon?: string;
  id: number;
  original_url?: string;
  app_unfurl_url?: string;
  is_app_unfurl?: boolean;
  app_id?: string;
  bot_id?: string;
  preview?: {
    type: string;
    can_remove: boolean;
  };
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
    verbatim?: boolean;
  };
  block_id?: string;
  elements?: any[];
  accessory?: any;
  fields?: any[];
}

export interface SlackReaction {
  name: string;
  users: string[];
  count: number;
}

// API Request/Response types for 2025 methods

export interface SlackChannelCreateRequest {
  name: string;
  is_private?: boolean;
  team_id?: string;
}

export interface SlackChannelCreateResponse {
  ok: boolean;
  channel: SlackChannel;
  error?: string;
  response_metadata?: {
    warnings?: string[];
  };
}

export interface SlackMessagePostRequest {
  channel: string;
  text?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  thread_ts?: string;
  reply_broadcast?: boolean;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  username?: string;
  as_user?: boolean;
  icon_url?: string;
  icon_emoji?: string;
  link_names?: boolean;
  mrkdwn?: boolean;
}

export interface SlackMessagePostResponse {
  ok: boolean;
  channel: string;
  ts: string;
  message: SlackMessage;
  error?: string;
  response_metadata?: {
    warnings?: string[];
  };
}

// New 2025 File Upload API types
export interface SlackFileGetUploadURLRequest {
  filename: string;
  length: number;
  alt_txt?: string;
  snippet_type?: string;
}

export interface SlackFileGetUploadURLResponse {
  ok: boolean;
  upload_url: string;
  file_id: string;
  error?: string;
}

export interface SlackFileCompleteUploadRequest {
  files: Array<{
    id: string;
    title?: string;
  }>;
  channel_id?: string;
  initial_comment?: string;
  thread_ts?: string;
}

export interface SlackFileCompleteUploadResponse {
  ok: boolean;
  files: SlackFile[];
  error?: string;
}

export interface SlackConversationRepliesRequest {
  channel: string;
  ts: string;
  cursor?: string;
  inclusive?: boolean;
  latest?: string;
  limit?: number;
  oldest?: string;
}

export interface SlackConversationRepliesResponse {
  ok: boolean;
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
  error?: string;
}

// Import data structure for transformation
export interface SlackImportChannel {
  name: string;
  is_private: boolean;
  topic?: string;
  purpose?: string;
  messages: SlackImportMessage[];
}

export interface SlackImportMessage {
  text: string;
  user_email: string;
  timestamp: string; // ISO string, will be used for ordering
  thread_ts?: string; // Parent message timestamp for thread replies
  attachments?: SlackImportAttachment[];
  reactions?: Array<{
    name: string;
    count: number;
    users: string[]; // User emails
  }>;
  mentions?: Array<{
    user_email: string;
    display_name: string;
  }>;
}

export interface SlackImportAttachment {
  filename: string;
  content_type: string;
  local_path: string; // Path to downloaded file
  title?: string;
  alt_text?: string;
}

export interface SlackImportData {
  export_timestamp: string;
  channels: SlackImportChannel[];
  users: Array<{
    email: string;
    display_name: string;
    real_name?: string;
    avatar_local_path?: string; // Path to downloaded avatar
  }>;
}

// Utility types for mapping
export interface UserMapping {
  google_chat_id: string; // people/123456789
  google_chat_email: string;
  slack_user_id?: string; // Will be resolved during import
  display_name: string;
}

export interface ChannelMapping {
  google_chat_space_id: string; // spaces/ABC123
  google_chat_display_name: string;
  slack_channel_name: string; // Normalized for Slack
  is_private: boolean;
  slack_channel_id?: string; // Will be set during import
}
