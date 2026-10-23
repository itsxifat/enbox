/**
 * What's New: the changelog, newest first. A new entry takes the next `version` and the
 * release date; WHATS_NEW_VERSION and WHATS_NEW_DATE (store.ts) follow it.
 */
export interface ChangelogItem {
  title: string;
  text: string;
}

export interface ChangelogEntry {
  version: number;
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 13,
    date: '2026-10-23',
    title: 'Everyday upgrades',
    items: [
      {
        title: 'A smarter message box',
        text: 'See who’s typing, a slowmode countdown and a character counter. Type # for channels and : for emoji, start with @silent to skip notifications, and send long text as a file.',
      },
      {
        title: 'Easier reading',
        text: 'Channel intros, a “new messages” bar with Mark As Read, “Today at” times, highlighted mentions, channel links, colourful code blocks and a check before you leave Enbox for another site.',
      },
      {
        title: 'Make it yours',
        text: 'Compact mode, eight gradient colour themes or your own, a chat font slider, UI density and zoom. Your appearance follows you to your other devices.',
      },
      {
        title: 'DMs and friends',
        text: 'Right-click anyone for their menu, open their profile beside your DM, start calls from the header, share a friend invite link and get a heads-up when friends come online.',
      },
      {
        title: 'Bookmarks and reminders',
        text: 'Save messages and get reminded later from the message menu; find them in the Inbox. Banners show new messages while you’re in another chat.',
      },
      {
        title: 'Find your way around',
        text: 'Back and Forward in a slim bar across the top (Alt+← and Alt+→, or ⌘[ and ⌘] on a Mac), activity glyphs on your Spaces, “new unreads” pills, a resizable channel list and Online/Offline in the member list.',
      },
      {
        title: 'Right where you left off',
        text: 'Enbox opens on the last place you were, and every Space on its last channel.',
      },
    ],
  },
  {
    version: 12,
    date: '2026-10-23',
    title: 'Super Reactions, timed polls and server tags',
    items: [
      { title: 'Super Reactions', text: 'A glowing reaction with a burst, next to the regular ones.' },
      {
        title: 'Polls',
        text: 'End after the time you pick or right away, hide results until people vote, give each answer an emoji and post the result when it closes.',
      },
      {
        title: 'Formatting',
        text: 'Ctrl+B, I and U (⌘ on a Mac), a toolbar over selected text and coloured code blocks.',
      },
      { title: 'Forward with a message', text: 'Add a note when you forward; copies link back to the original.' },
      {
        title: 'Accessibility',
        text: 'Saturation, contrast, link underlines, role colours, animation, a send button and message spacing in Settings → Accessibility, and keyboard navigation between messages.',
      },
      { title: 'Server tags', text: 'Wear a Space’s short tag and badge next to your name.' },
      {
        title: 'Forum posts',
        text: 'Follow, close, lock, pin and rename posts, with up to 10 files each, and media channels.',
      },
    ],
  },
  {
    version: 11,
    date: '2026-10-23',
    title: 'Text in voice, Go Live and the Server Guide',
    items: [
      { title: 'Text in voice', text: 'Every voice and Stage channel has its own chat beside the call.' },
      {
        title: 'Go Live',
        text: 'Share your screen in the quality you pick; others click Watch, go fullscreen or picture-in-picture.',
      },
      { title: 'Active Now', text: 'See which voice channels your friends are in from the Friends page.' },
      {
        title: 'Server Guide',
        text: 'A welcome sign, to-dos and resources, with Browse Channels and Channels & Roles to choose what you see.',
      },
      {
        title: 'Moderation and insights',
        text: 'A Members page with filters and bulk actions, Mod View, paused invites, raid alerts and daily insights for Space owners.',
      },
      { title: 'Look before you join', text: 'Preview a discoverable Space before joining it.' },
    ],
  },
  {
    version: 10,
    date: '2026-10-23',
    title: 'Message requests, webhooks and announcements',
    items: [
      {
        title: 'Message requests',
        text: 'Messages from people who aren’t your friends wait in Message Requests until you accept them.',
      },
      { title: 'Ignore and report', text: 'Quietly ignore someone, and report messages, people and Spaces.' },
      { title: 'Webhooks', text: 'Post into channels from other apps, with rich embeds.' },
      {
        title: 'Announcement channels',
        text: 'Publish a post to every channel that follows yours, in any Space.',
      },
      { title: 'Space templates', text: 'Start a Space from a template, or share yours as one.' },
      {
        title: 'Rich links',
        text: 'YouTube, Vimeo, Twitch, Spotify and SoundCloud players, message link and invite cards, and /tts.',
      },
      {
        title: 'Voice settings',
        text: 'Pick your devices, test your mic, push-to-talk, input sensitivity and a volume for each person.',
      },
    ],
  },
  {
    version: 9,
    date: '2026-10-23',
    title: 'Stickers, Stage channels and the soundboard',
    items: [
      { title: 'Stickers', text: 'Add stickers to your Space and send them from the picker.' },
      { title: 'More files', text: 'Up to 10 files per message, each with alt text.' },
      { title: 'Stage channels', text: 'Talks with speakers, an audience and raised hands.' },
      { title: 'Soundboard', text: 'Play short sounds for everyone in your voice channel.' },
      { title: 'Group DMs', text: 'Chat with up to 10 friends at once.' },
      { title: 'Two-factor sign-in', text: 'Protect your account with an authenticator app and backup codes.' },
      { title: 'Streamer Mode', text: 'Hide personal details while you share your screen.' },
    ],
  },
  {
    version: 8,
    date: '2026-10-23',
    title: 'Events, forums and AutoMod',
    items: [
      { title: 'Events', text: 'Schedule events with reminders, then gather in voice when they start.' },
      { title: 'Forum channels', text: 'Posts with tags, guidelines and a gallery view.' },
      { title: 'AutoMod', text: 'Keeps out banned words, mention spam and spam links.' },
      {
        title: 'Discover',
        text: 'Find public Spaces, with a welcome screen and onboarding questions that hand out roles.',
      },
      { title: 'Settings over the page', text: 'User Settings opens over the page you were on, and Esc goes back.' },
      {
        title: 'Message actions',
        text: 'Quick reactions on hover, pins, Mark Unread, Copy Message Link and slash commands.',
      },
    ],
  },
  {
    version: 7,
    date: '2026-10-23',
    title: 'Reactions, custom emoji, friends and threads',
    items: [
      { title: 'Reactions', text: 'React with as many emoji as you like and see who reacted.' },
      { title: 'Custom emoji', text: 'Upload your Space’s own emoji and use them in messages and reactions.' },
      { title: 'Friends', text: 'Send friend requests by username and manage them under Pending.' },
      { title: 'Inbox', text: 'Your mentions and unreads in one place (Ctrl+I).' },
      { title: 'Threads', text: 'Branch off a conversation into a thread beside the channel.' },
      { title: 'Search', text: 'Search with filters like from:, has:, before: and in:.' },
    ],
  },
  {
    version: 6,
    date: '2026-10-23',
    title: 'Profiles and cosmetics',
    items: [
      {
        title: 'Make it yours',
        text: 'Avatar decorations, profile effects, nameplates and display name fonts, all free.',
      },
      {
        title: 'Profiles',
        text: 'A themed profile with banner, bio, roles, mutual Spaces and friends, and a private note.',
      },
      {
        title: 'Per-Space profiles and role styles',
        text: 'A different look in each Space, and solid, gradient or holographic role colours with icons.',
      },
      {
        title: 'Drag and drop',
        text: 'Drop files into conversations, Spaces into folders, and reorder channels and voice members.',
      },
      { title: 'Quick Switcher', text: 'Ctrl+K jumps to any chat, channel or Space.' },
    ],
  },
  {
    version: 5,
    date: '2026-10-22',
    title: 'Voice channels',
    items: [
      { title: 'Voice channels', text: 'Join with one click, then mute, deafen, turn on your camera or share your screen.' },
      {
        title: 'Space options',
        text: 'Menus for Spaces, channels and categories, mute for a while, notification settings and Hide Muted Channels.',
      },
    ],
  },
  {
    version: 4,
    date: '2026-10-22',
    title: 'Markdown in messages',
    items: [
      {
        title: 'Formatting',
        text: 'Headers, quotes, lists, code blocks, spoilers, masked links and timestamps.',
      },
    ],
  },
  {
    version: 3,
    date: '2026-10-22',
    title: 'A new home',
    items: [
      { title: 'One list for everything', text: 'Home with your DMs, then the Spaces you’re in.' },
      { title: 'Friends', text: 'The Friends page, the DM list and your user panel.' },
      { title: 'Themes', text: 'Light, Ash, Dark and Onyx.' },
    ],
  },
  {
    version: 2,
    date: '2026-10-22',
    title: 'Spaces',
    items: [
      {
        title: 'Spaces',
        text: 'Communities become Spaces: channels and categories, roles and permissions, a member list and mentions.',
      },
    ],
  },
  {
    version: 1,
    date: '2026-10-22',
    title: 'Link previews and clearer calls',
    items: [
      { title: 'Link previews', text: 'Links in chats show a preview; turn it off in Settings → Chats.' },
      { title: 'Clearer calls', text: 'Voice isolation and noise cancellation for calls.' },
    ],
  },
];
