import { PERM } from '@enbox/shared';

export interface PermissionInfo {
  bit: number;
  label: string;
  description: string;
  /**
   * Channel permissions only, never on roles: an IMPLICIT_PERMISSIONS bit (permissions.ts)
   * every member holds, which only a channel overwrite can deny.
   */
  channelOnly?: boolean;
}

export interface PermissionGroup {
  title: string;
  /** Shown in channel overwrites for these channel types. */
  channel: ('space_text' | 'space_voice')[];
  items: PermissionInfo[];
}

/** Permission editor groups (reserved bits are never shown). */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'General',
    channel: ['space_text', 'space_voice'],
    items: [
      { bit: PERM.VIEW_CHANNEL, label: 'View channels', description: 'See the channel and read its messages.' },
      { bit: PERM.MANAGE_CHANNELS, label: 'Manage channels', description: 'Create, edit and delete channels.' },
      { bit: PERM.MANAGE_ROLES, label: 'Manage roles and permissions', description: 'Create and edit roles below their own, and change channel permissions.' },
      { bit: PERM.CREATE_INVITE, label: 'Create invite', description: 'Invite people to the Space.' },
    ],
  },
  {
    title: 'Text channels',
    channel: ['space_text'],
    items: [
      { bit: PERM.SEND_MESSAGES, label: 'Send messages', description: 'Post in text channels.' },
      { bit: PERM.ATTACH_FILES, label: 'Attach files', description: 'Upload photos, videos, voice notes and files.' },
      {
        bit: PERM.EMBED_LINKS,
        label: 'Embed links',
        description: 'Links show previews and players. Everyone can unless it’s denied in this channel.',
        channelOnly: true,
      },
      { bit: PERM.ADD_REACTIONS, label: 'Add reactions', description: 'React to messages.' },
      {
        bit: PERM.USE_EXTERNAL_EMOJI,
        label: 'Use external emoji',
        description: 'Use emoji from other Spaces here. Everyone can unless it’s denied in this channel.',
        channelOnly: true,
      },
      { bit: PERM.SEND_POLLS, label: 'Create polls', description: 'Post polls.' },
      { bit: PERM.MENTION_EVERYONE, label: 'Mention @everyone, @here and all roles', description: 'Notify the whole Space, and mention roles that aren’t mentionable.' },
      { bit: PERM.MANAGE_MESSAGES, label: 'Manage messages', description: 'Delete others’ messages and pin messages.' },
    ],
  },
  {
    title: 'Voice channels',
    channel: ['space_voice'],
    items: [
      { bit: PERM.CONNECT, label: 'Connect', description: 'Join voice channels.' },
      { bit: PERM.SPEAK, label: 'Speak', description: 'Talk in voice channels.' },
      { bit: PERM.VIDEO, label: 'Video', description: 'Turn the camera on.' },
      { bit: PERM.STREAM, label: 'Share screen', description: 'Share a screen or window.' },
      { bit: PERM.MUTE_MEMBERS, label: 'Mute members', description: 'Mute others for everyone.' },
      { bit: PERM.DEAFEN_MEMBERS, label: 'Deafen members', description: 'Stop others from hearing.' },
      { bit: PERM.MOVE_MEMBERS, label: 'Move members', description: 'Move people between voice channels.' },
    ],
  },
  {
    title: 'Membership',
    channel: [],
    items: [
      { bit: PERM.CHANGE_NICKNAME, label: 'Change nickname', description: 'Set their own nickname in this Space.' },
      { bit: PERM.MANAGE_NICKNAMES, label: 'Manage nicknames', description: 'Change other members’ nicknames.' },
      { bit: PERM.MODERATE_MEMBERS, label: 'Time out members', description: 'Stop members from talking for a while.' },
      { bit: PERM.KICK_MEMBERS, label: 'Kick members', description: 'Remove members (they can rejoin with an invite).' },
      { bit: PERM.BAN_MEMBERS, label: 'Ban members', description: 'Remove members for good.' },
    ],
  },
  {
    title: 'Advanced',
    channel: [],
    items: [
      { bit: PERM.MANAGE_SPACE, label: 'Manage Space', description: 'Change the name, icon, banner and settings.' },
      { bit: PERM.MANAGE_EMOJI, label: 'Manage emoji', description: 'Upload, rename and delete this Space’s custom emoji.' },
      { bit: PERM.MANAGE_WEBHOOKS, label: 'Manage webhooks', description: 'Create, edit and delete webhooks, and follow announcement channels into this Space.' },
      { bit: PERM.VIEW_AUDIT_LOG, label: 'View audit log', description: 'See who changed what.' },
      { bit: PERM.ADMINISTRATOR, label: 'Administrator', description: 'Every permission, and channel permissions don’t apply. Grant with care.' },
    ],
  },
];
