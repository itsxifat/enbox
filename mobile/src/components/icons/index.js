/**
 * Enbox icon set (the web client's components/icons, drawn with react-native-svg on lucide's
 * 24-unit grid) plus `Icon`, the one way to render any icon — lucide or Enbox — with the
 * app-wide stroke: ICON_STROKE screen pixels at every size (lucide's `absoluteStrokeWidth`).
 *
 *   <Icon icon={Search} size={18} color={c.subtle} />
 *   <Icon icon={ChatsFilledIcon} size={24} color={c['brand-ink']} />
 */
import { useId } from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';

/** Line weight of every UI icon, in screen pixels at any icon size. */
export const ICON_STROKE = 1.5;
/** Emphasis weight: checkmarks in selection circles, tiny glyphs on filled chips/badges. */
export const ICON_STROKE_BOLD = 2;
/** Light glyphs on filled color (brand buttons, FABs, call controls) read thinner: add weight. */
export const ICON_STROKE_ON_FILL = 1.75;

/**
 * Render an icon component with the app's stroke defaults. `scale` opts back into strokes
 * that scale with the glyph (large illustrative icons: empty states, avatar fallbacks).
 */
export function Icon({
  icon: I,
  size = 24,
  color,
  strokeWidth = ICON_STROKE,
  scale = false,
  style,
}) {
  if (!I) return null;
  return (
    <I
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={!scale}
      style={style}
    />
  );
}

/**
 * Build an Enbox icon with lucide's props (`size`, `color`, `strokeWidth`,
 * `absoluteStrokeWidth`). `render({ uid, sw, color })` returns the SVG children; outline
 * parts inherit the root stroke, filled parts set `fill={color}`.
 */
function createIcon(name, render) {
  function EnboxIcon({ size = 24, color = '#000', strokeWidth = 2, absoluteStrokeWidth, style }) {
    const px = Number(size);
    const stroke = Number(strokeWidth);
    const sw = absoluteStrokeWidth ? (stroke * 24) / px : stroke;
    const uid = `ei${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return (
      <Svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
      >
        {render({ uid, sw, color })}
      </Svg>
    );
  }
  EnboxIcon.displayName = name;
  return EnboxIcon;
}

// ---------------------------------------------------------------------------
// Chats — rounded speech bubble (filled: three "typing" dots cut out)
// ---------------------------------------------------------------------------
const BUBBLE =
  'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092A10 10 0 1 0 2.992 16.342z';

export const ChatsIcon = createIcon('enbox-chats', () => <Path d={BUBBLE} />);

export const ChatsFilledIcon = createIcon('enbox-chats-filled', ({ uid, color }) => (
  <>
    <Defs>
      <Mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
        <Rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
        <G fill="#000" stroke="none">
          <Circle cx="7.75" cy="12" r="1.35" />
          <Circle cx="12" cy="12" r="1.35" />
          <Circle cx="16.25" cy="12" r="1.35" />
        </G>
      </Mask>
    </Defs>
    <Path d={BUBBLE} fill={color} mask={`url(#${uid})`} />
  </>
));

export const NewChatIcon = createIcon('enbox-new-chat', () => (
  <>
    <Path d={BUBBLE} />
    <Path d="M12 8.25v7.5M8.25 12h7.5" />
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
const storyRing = () => STORY_RING.map((d) => <Path key={d} d={d} />);

export const UpdatesIcon = createIcon('enbox-updates', () => (
  <>
    {storyRing()}
    <Circle cx="12" cy="12" r="4.25" />
  </>
));

export const UpdatesFilledIcon = createIcon('enbox-updates-filled', ({ color }) => (
  <>
    {storyRing()}
    <Circle cx="12" cy="12" r="5.25" fill={color} stroke="none" />
  </>
));

// ---------------------------------------------------------------------------
// Communities — a person in front of two others
// ---------------------------------------------------------------------------
const FRONT_BODY = 'M5.75 20.5a6.25 6.25 0 0 1 12.5 0';

export const CommunitiesIcon = createIcon('enbox-communities', () => (
  <>
    <Circle cx="12" cy="7.75" r="3.25" />
    <Path d={FRONT_BODY} />
    <Circle cx="4.75" cy="10.25" r="2.1" />
    <Circle cx="19.25" cy="10.25" r="2.1" />
    <Path d="M1.25 19.5a3.5 3.5 0 0 1 3.5-3.5" />
    <Path d="M22.75 19.5a3.5 3.5 0 0 0-3.5-3.5" />
  </>
));

export const CommunitiesFilledIcon = createIcon(
  'enbox-communities-filled',
  ({ uid, sw, color }) => (
    <>
      <Defs>
        {/* The people behind are cut away around the front person, leaving a clean gap. */}
        <Mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
          <Rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
          <G fill="#000" stroke="#000" strokeWidth={sw + 3}>
            <Circle cx="12" cy="7.75" r="3.25" />
            <Path d={`${FRONT_BODY}z`} />
          </G>
        </Mask>
      </Defs>
      <G fill={color} mask={`url(#${uid})`}>
        <Circle cx="4.75" cy="10.25" r="2.1" />
        <Circle cx="19.25" cy="10.25" r="2.1" />
        <Path d="M1.25 19.5a3.5 3.5 0 0 1 7 0z" />
        <Path d="M15.75 19.5a3.5 3.5 0 0 1 7 0z" />
      </G>
      <Circle cx="12" cy="7.75" r="3.25" fill={color} />
      <Path d={`${FRONT_BODY}z`} fill={color} />
    </>
  ),
);

// ---------------------------------------------------------------------------
// Calls — phone handset
// ---------------------------------------------------------------------------
const HANDSET =
  'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384z';

export const CallsIcon = createIcon('enbox-calls', () => <Path d={HANDSET} />);
export const CallsFilledIcon = createIcon('enbox-calls-filled', ({ color }) => (
  <Path d={HANDSET} fill={color} />
));

// ---------------------------------------------------------------------------
// Call actions — camera and handsets drawn as one optically matched set (see the web set).
// ---------------------------------------------------------------------------
const CAMERA_LENS =
  'M16.5 10.25l3.82-2.674a.75.75 0 0 1 1.18.614v7.62a.75.75 0 0 1-1.18.614L16.5 13.75';
const SLASH = 'M2 2l20 20';

export const VideoIcon = createIcon('enbox-video', () => (
  <>
    <Rect x="2.5" y="4.5" width="14" height="15" rx="3.25" />
    <Path d={CAMERA_LENS} />
  </>
));

export const VideoOffIcon = createIcon('enbox-video-off', ({ uid, sw }) => (
  <>
    <Defs>
      <Mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
        <Rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
        <Path d={SLASH} stroke="#000" strokeWidth={sw * 3} />
      </Mask>
    </Defs>
    <G mask={`url(#${uid})`}>
      <Rect x="2.5" y="4.5" width="14" height="15" rx="3.25" />
      <Path d={CAMERA_LENS} />
    </G>
    <Path d={SLASH} />
  </>
));

/** 90% around the center; the stroke is scaled back up so the line weight stays the same. */
const CALL_SCALE = 0.9;

const callIcon = (name, paths) =>
  createIcon(name, ({ sw }) => (
    <G transform="matrix(.9 0 0 .9 1.2 1.2)" strokeWidth={sw / CALL_SCALE}>
      {paths.map((d) => (
        <Path key={d} d={d} />
      ))}
    </G>
  ));

export const PhoneIcon = callIcon('enbox-phone', [HANDSET]);
export const PhoneCallIcon = callIcon('enbox-phone-call', [
  'M13 2a9 9 0 0 1 9 9',
  'M13 6a5 5 0 0 1 5 5',
  HANDSET,
]);
export const PhoneIncomingIcon = callIcon('enbox-phone-incoming', [
  'M16 2v6h6',
  'm22 2-6 6',
  HANDSET,
]);
export const PhoneOutgoingIcon = callIcon('enbox-phone-outgoing', [
  'm16 8 6-6',
  'M22 8V2h-6',
  HANDSET,
]);
export const PhoneMissedIcon = callIcon('enbox-phone-missed', ['m16 2 6 6', 'm22 2-6 6', HANDSET]);
export const PhoneOffIcon = callIcon('enbox-phone-off', [
  'M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272',
  'M22 2 2 22',
  'M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473',
]);

// ---------------------------------------------------------------------------
// Settings — gear (filled: solid gear with a round hub hole)
// ---------------------------------------------------------------------------
const GEAR =
  'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915z';

export const SettingsIcon = createIcon('enbox-settings', () => (
  <>
    <Path d={GEAR} />
    <Circle cx="12" cy="12" r="3" />
  </>
));

export const SettingsFilledIcon = createIcon('enbox-settings-filled', ({ uid, color }) => (
  <>
    <Defs>
      <Mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
        <Rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
        <Circle cx="12" cy="12" r="3.1" fill="#000" stroke="none" />
      </Mask>
    </Defs>
    <Path d={GEAR} fill={color} mask={`url(#${uid})`} />
  </>
));

// ---------------------------------------------------------------------------
// Message ticks — equal, parallel checks (WhatsApp-style) tuned for 14–18px
// ---------------------------------------------------------------------------
export const TickIcon = createIcon('enbox-tick', () => <Path d="M4.5 12.75 9 17.25 19.5 6.75" />);

export const DoubleTickIcon = createIcon('enbox-double-tick', () => (
  <>
    <Path d="M1.5 12.75 6 17.25 16.5 6.75" />
    <Path d="M10.75 16.5l.75.75L22 6.75" />
  </>
));

// ---------------------------------------------------------------------------
// Send — solid paper plane with a folded crease (for filled brand buttons)
// ---------------------------------------------------------------------------
export const SendIcon = createIcon('enbox-send', ({ uid, color }) => (
  <>
    <Defs>
      <Mask id={uid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
        <Rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
        <Path d="M6.75 12h6.25" stroke="#000" strokeWidth="1.75" />
      </Mask>
    </Defs>
    <Path d="M4 3.75 21.5 12 4 20.25 6.75 12z" fill={color} mask={`url(#${uid})`} />
  </>
));

// ---------------------------------------------------------------------------
// Logo — the app icon (components/common/Logo on the web)
// ---------------------------------------------------------------------------
export function LogoMark({ size = 56, radius = 116 }) {
  const uid = `lg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradientDef id={uid} />
      </Defs>
      <Rect width="512" height="512" rx={radius} fill={`url(#${uid})`} />
      <Path
        d="M256 108c-89 0-160 62-160 142 0 42 20 80 52 106l-14 62 66-31c17 5 36 7 56 7 89 0 160-62 160-144S345 108 256 108z"
        fill="#fff"
      />
      <Path
        d="M190 252h132a66 66 0 1 0-19 46"
        fill="none"
        stroke="#6D5DFC"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function LinearGradientDef({ id }) {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <Stop offset="0" stopColor="#8B7DFF" />
      <Stop offset="1" stopColor="#5A48E8" />
    </LinearGradient>
  );
}
