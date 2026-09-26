/**
 * Enbox icon set: the app's signature glyphs (tabs, status, ticks, send), drawn on lucide's
 * 24-unit grid so they sit seamlessly next to lucide icons. Each tab icon has an outline
 * and a filled (active) variant with an identical silhouette, so switching tabs never
 * shifts or resizes the glyph.
 *
 * Import from '@/components/icons'. All icons accept the lucide props (`size`,
 * `strokeWidth`, `className`, `aria-*`) and satisfy `IconType`.
 */
import type { ReactNode } from 'react';
import { LucideProvider } from 'lucide-react';
import { createIcon } from './createIcon';

export { createIcon, type IconRenderContext } from './createIcon';

/**
 * Line weight of every UI icon, in screen pixels at any icon size (non-scaling stroke), so a
 * 14px glyph in a chat row and a 24px glyph in a header share one crisp weight.
 */
export const ICON_STROKE = 1.5;
/** Emphasis weight: checkmarks in selection circles, tiny glyphs on filled chips/badges. */
export const ICON_STROKE_BOLD = 2;
/** Light glyphs on filled color (brand buttons, FABs, call controls) read thinner: add weight. */
export const ICON_STROKE_ON_FILL = 1.75;

/**
 * App-wide icon defaults (lucide + Enbox icons). Large illustrative icons (empty states,
 * avatar fallbacks) opt back into proportional strokes with `nonScalingStroke={false}`.
 */
export function IconProvider({ children }: { children: ReactNode }) {
  return (
    <LucideProvider nonScalingStroke strokeWidth={ICON_STROKE}>
      {children}
    </LucideProvider>
  );
}

const fill = { fill: 'currentColor' } as const;
const solid = { fill: 'currentColor', stroke: 'none' } as const;

// ---------------------------------------------------------------------------
// Chats — rounded speech bubble (filled: three "typing" dots cut out)
// ---------------------------------------------------------------------------
const BUBBLE =
  'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092A10 10 0 1 0 2.992 16.342z';

export const ChatsIcon = createIcon('enbox-chats', () => <path d={BUBBLE} />);

export const ChatsFilledIcon = createIcon('enbox-chats-filled', ({ uid }) => (
  <>
    <mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
      <rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
      <g fill="#000" stroke="none">
        <circle cx="7.75" cy="12" r="1.35" />
        <circle cx="12" cy="12" r="1.35" />
        <circle cx="16.25" cy="12" r="1.35" />
      </g>
    </mask>
    <path d={BUBBLE} {...fill} mask={`url(#${uid})`} />
  </>
));

export const NewChatIcon = createIcon('enbox-new-chat', () => (
  <>
    <path d={BUBBLE} />
    <path d="M12 8.25v7.5M8.25 12h7.5" />
  </>
));

// ---------------------------------------------------------------------------
// Updates / status — a segmented story ring around an avatar (filled: solid core)
// ---------------------------------------------------------------------------
const STORY_RING = [
  'M13.975 2.708A9.5 9.5 0 0 1 21.035 14.936',
  'M19.06 18.357A9.5 9.5 0 0 1 4.94 18.357',
  'M2.965 14.936A9.5 9.5 0 0 1 10.025 2.708',
];
const storyRing = STORY_RING.map((d) => <path key={d} d={d} />);

export const UpdatesIcon = createIcon('enbox-updates', () => (
  <>
    {storyRing}
    <circle cx="12" cy="12" r="4.25" />
  </>
));

export const UpdatesFilledIcon = createIcon('enbox-updates-filled', () => (
  <>
    {storyRing}
    <circle cx="12" cy="12" r="5.25" {...solid} />
  </>
));

// ---------------------------------------------------------------------------
// Communities — a person in front of two others
// ---------------------------------------------------------------------------
const FRONT_HEAD = { cx: 12, cy: 7.75, r: 3.25 } as const;
const FRONT_BODY = 'M5.75 20.5a6.25 6.25 0 0 1 12.5 0';

export const CommunitiesIcon = createIcon('enbox-communities', () => (
  <>
    <circle {...FRONT_HEAD} />
    <path d={FRONT_BODY} />
    <circle cx="4.75" cy="10.25" r="2.1" />
    <circle cx="19.25" cy="10.25" r="2.1" />
    <path d="M1.25 19.5a3.5 3.5 0 0 1 3.5-3.5" />
    <path d="M22.75 19.5a3.5 3.5 0 0 0-3.5-3.5" />
  </>
));

export const CommunitiesFilledIcon = createIcon('enbox-communities-filled', ({ uid, sw }) => (
  <>
    {/* The people behind are cut away around the front person, leaving a clean gap. */}
    <mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
      <rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
      <g fill="#000" stroke="#000" strokeWidth={sw + 3}>
        <circle {...FRONT_HEAD} />
        <path d={`${FRONT_BODY}z`} />
      </g>
    </mask>
    <g {...fill} mask={`url(#${uid})`}>
      <circle cx="4.75" cy="10.25" r="2.1" />
      <circle cx="19.25" cy="10.25" r="2.1" />
      <path d="M1.25 19.5a3.5 3.5 0 0 1 7 0z" />
      <path d="M15.75 19.5a3.5 3.5 0 0 1 7 0z" />
    </g>
    <circle {...FRONT_HEAD} {...fill} />
    <path d={`${FRONT_BODY}z`} {...fill} />
  </>
));

// ---------------------------------------------------------------------------
// Calls — phone handset
// ---------------------------------------------------------------------------
const HANDSET =
  'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384z';

export const CallsIcon = createIcon('enbox-calls', () => <path d={HANDSET} />);
export const CallsFilledIcon = createIcon('enbox-calls-filled', () => (
  <path d={HANDSET} {...fill} />
));

// ---------------------------------------------------------------------------
// Settings — gear (filled: solid gear with a round hub hole)
// ---------------------------------------------------------------------------
const GEAR =
  'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915z';

export const SettingsIcon = createIcon('enbox-settings', () => (
  <>
    <path d={GEAR} />
    <circle cx="12" cy="12" r="3" />
  </>
));

export const SettingsFilledIcon = createIcon('enbox-settings-filled', ({ uid }) => (
  <>
    <mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
      <rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
      <circle cx="12" cy="12" r="3.1" fill="#000" stroke="none" />
    </mask>
    <path d={GEAR} {...fill} mask={`url(#${uid})`} />
  </>
));

// ---------------------------------------------------------------------------
// Message ticks — equal, parallel checks (WhatsApp-style) tuned for 14–18px
// ---------------------------------------------------------------------------
export const TickIcon = createIcon('enbox-tick', () => <path d="M4.5 12.75 9 17.25 19.5 6.75" />);

export const DoubleTickIcon = createIcon('enbox-double-tick', () => (
  <>
    <path d="M1.5 12.75 6 17.25 16.5 6.75" />
    <path d="M10.75 16.5l.75.75L22 6.75" />
  </>
));

// ---------------------------------------------------------------------------
// Send — solid paper plane with a folded crease (for filled brand buttons); nudged right
// half a unit so its visual mass, not its box, is centered in round buttons
// ---------------------------------------------------------------------------
export const SendIcon = createIcon('enbox-send', ({ uid }) => (
  <>
    <mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
      <rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
      <path d="M6.75 12h6.25" stroke="#000" strokeWidth="1.75" />
    </mask>
    <path d="M4 3.75 21.5 12 4 20.25 6.75 12z" {...fill} mask={`url(#${uid})`} />
  </>
));
