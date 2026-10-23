/**
 * The "Create Your Space" starter templates (Discord's Gaming, School Club, Study Group,
 * Friends, Artists & Creators and Local Community). `POST /api/spaces { template: id }`
 * builds the Space from the snapshot; the web picker shows the name and description.
 */
import type {
  SpaceTemplateSnapshot,
  StarterTemplateId,
  TemplateChannel,
  TemplateRole,
} from './integrations.js';
import { DEFAULT_EVERYONE_PERMISSIONS, PERM } from './permissions.js';

export interface StarterTemplate {
  id: StarterTemplateId;
  name: string;
  description: string;
  snapshot: SpaceTemplateSnapshot;
}

const everyone: TemplateRole = {
  name: '@everyone',
  isDefault: true,
  color: null,
  permissions: DEFAULT_EVERYONE_PERMISSIONS,
  hoist: false,
  mentionable: false,
};

const text = (
  name: string,
  category: number,
  extra: Partial<TemplateChannel> = {},
): TemplateChannel => ({
  type: 'space_text',
  name,
  topic: null,
  category,
  nsfw: false,
  slowmodeSeconds: 0,
  userLimit: null,
  isNews: false,
  overwrites: [],
  ...extra,
});

const voice = (name: string, category: number): TemplateChannel => ({
  ...text(name, category),
  type: 'space_voice',
});

/** Members read announcements; only people with an allowing role post. */
const announcements = (category: number): TemplateChannel =>
  text('announcements', category, {
    isNews: true,
    overwrites: [{ role: 0, allow: 0, deny: PERM.SEND_MESSAGES }],
  });

function snapshot(
  categories: string[],
  channels: TemplateChannel[],
  systemChannel: string,
): SpaceTemplateSnapshot {
  const system = channels.findIndex((c) => c.name === systemChannel);
  return {
    roles: [everyone],
    categories: categories.map((name) => ({ name, overwrites: [] })),
    channels,
    systemChannel: system >= 0 ? system : null,
    afkChannel: null,
  };
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: 'gaming',
    name: 'Gaming',
    description: 'Play together, share clips and hang out in voice.',
    snapshot: snapshot(
      ['Text Channels', 'Voice Channels'],
      [text('general', 0), text('clips-and-highlights', 0), voice('Lobby', 1), voice('Gaming', 1)],
      'general',
    ),
  },
  {
    id: 'school-club',
    name: 'School Club',
    description: 'Plan meetings, share resources and post club news.',
    snapshot: snapshot(
      ['Information', 'Text Channels', 'Voice Channels'],
      [
        text('welcome-and-rules', 0),
        announcements(0),
        text('resources', 0),
        text('general', 1),
        text('meeting-plans', 1),
        text('off-topic', 1),
        voice('Lounge', 2),
        voice('Meeting Room', 2),
      ],
      'general',
    ),
  },
  {
    id: 'study-group',
    name: 'Study Group',
    description: 'Homework help, shared notes and study rooms.',
    snapshot: snapshot(
      ['Information', 'Text Channels', 'Voice Channels'],
      [
        text('welcome-and-rules', 0),
        text('notes-resources', 0),
        text('general', 1),
        text('homework-help', 1),
        text('session-planning', 1),
        text('off-topic', 1),
        voice('Lounge', 2),
        voice('Study Room 1', 2),
        voice('Study Room 2', 2),
      ],
      'general',
    ),
  },
  {
    id: 'friends',
    name: 'Friends',
    description: 'A place for you and your friends to talk and play.',
    snapshot: snapshot(
      ['Text Channels', 'Voice Channels'],
      [
        text('general', 0),
        text('games', 0),
        text('music', 0),
        voice('Lounge', 1),
        voice('Stream Room', 1),
      ],
      'general',
    ),
  },
  {
    id: 'artists',
    name: 'Artists & Creators',
    description: 'Share your work, get feedback and host events.',
    snapshot: snapshot(
      ['Information', 'Text Channels', 'Voice Channels'],
      [
        text('welcome-and-rules', 0),
        announcements(0),
        text('general', 1),
        text('events', 1),
        text('ideas-and-feedback', 1),
        voice('Lounge', 2),
        voice('Community Hangout', 2),
        voice('Stream Room', 2),
      ],
      'general',
    ),
  },
  {
    id: 'local-community',
    name: 'Local Community',
    description: 'Neighbourhood news, meetups and resources.',
    snapshot: snapshot(
      ['Information', 'Text Channels', 'Voice Channels'],
      [
        text('welcome-and-rules', 0),
        announcements(0),
        text('resources', 0),
        text('general', 1),
        text('meeting-plans', 1),
        text('off-topic', 1),
        voice('Lounge', 2),
        voice('Meeting Room', 2),
      ],
      'general',
    ),
  },
];

export function starterTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id);
}
