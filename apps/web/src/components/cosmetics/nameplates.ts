/**
 * Nameplate art per NAMEPLATES id: a base paint (CSS gradients) and an optional detail tile
 * (inline SVG data URI, `img-src data:` in the CSP) that drifts while the row is hovered.
 * The plate's mask (cosmetics.css) fades all of it out to the left, under the name.
 */
export interface NameplateArt {
  /** Base paint: one or more CSS backgrounds. */
  base: string;
  /** Detail tile (background-image) over the base. */
  fx?: string;
  /** background-size of the tile. */
  fxSize?: string;
  /** background-position of the tile (default: anchored to the bottom left). */
  fxPosition?: string;
  /** How the detail moves on hover. */
  motion?: 'drift' | 'rise' | 'twinkle';
  /** A light sweep across the plate on hover (metals, ice, candy). */
  shine?: boolean;
}

function tile(w: number, h: number, body: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const dot = (x: number, y: number, r: number, fill: string, op = 1) =>
  `<circle cx='${x}' cy='${y}' r='${r}' fill='${fill}'${op < 1 ? ` fill-opacity='${op}'` : ''}/>`;

const spark = (x: number, y: number, s: number, fill: string) => {
  const k = s * 0.22;
  return `<path d='M${x} ${y - s}Q${x + k} ${y - k} ${x + s} ${y}Q${x + k} ${y + k} ${x} ${y + s}Q${x - k} ${y + k} ${x - s} ${y}Q${x - k} ${y - k} ${x} ${y - s}Z' fill='${fill}'/>`;
};

const STARS = tile(
  64,
  40,
  [
    dot(6, 8, 0.8, '#fff'),
    dot(22, 30, 0.7, '#fff', 0.8),
    dot(37, 12, 1, '#fff'),
    dot(50, 33, 0.6, '#fff', 0.7),
    dot(58, 6, 0.7, '#fff', 0.9),
    dot(14, 20, 0.5, '#fff', 0.6),
    spark(44, 22, 2.6, '#fff'),
    spark(12, 34, 1.8, '#ffe9ff'),
  ].join(''),
);

const NIGHT_STARS = tile(
  56,
  40,
  [
    dot(5, 6, 0.8, '#fff'),
    dot(19, 24, 0.6, '#fff', 0.8),
    dot(31, 9, 0.9, '#fff7c2'),
    dot(46, 30, 0.7, '#fff', 0.8),
    dot(52, 14, 0.5, '#fff', 0.7),
    spark(24, 34, 2, '#fff7c2'),
    spark(40, 18, 1.6, '#fff'),
  ].join(''),
);

const FLOWER = (x: number, y: number, petal: string) =>
  [0, 72, 144, 216, 288]
    .map((a) => {
      const r = ((a - 90) * Math.PI) / 180;
      return dot(
        Math.round((x + Math.cos(r) * 2) * 10) / 10,
        Math.round((y + Math.sin(r) * 2) * 10) / 10,
        1.6,
        petal,
      );
    })
    .join('') + dot(x, y, 1, '#ffd84a');

const MEADOW = tile(
  44,
  44,
  [
    `<path d='M3 44L5 36L7 44M15 44L18 34L20 44M27 44L29 37L31 44M38 44L41 33L43 44' fill='#3f9a3a'/>`,
    FLOWER(9, 33, '#ff9ccf'),
    FLOWER(24, 38, '#ffffff'),
    FLOWER(36, 31, '#ffe066'),
  ].join(''),
);

const PETALS = tile(
  48,
  36,
  [
    `<ellipse cx='8' cy='9' rx='3.4' ry='2' transform='rotate(30 8 9)' fill='#fff' fill-opacity='0.85'/>`,
    `<ellipse cx='30' cy='22' rx='3' ry='1.8' transform='rotate(-25 30 22)' fill='#ff8fbf'/>`,
    `<ellipse cx='42' cy='6' rx='2.4' ry='1.5' transform='rotate(60 42 6)' fill='#fff' fill-opacity='0.75'/>`,
    `<ellipse cx='16' cy='30' rx='2.6' ry='1.6' transform='rotate(-60 16 30)' fill='#ffc2db'/>`,
  ].join(''),
);

const WAVES = tile(
  40,
  24,
  [
    `<path d='M0 8Q5 4 10 8T20 8T30 8T40 8' fill='none' stroke='#fff' stroke-opacity='0.35' stroke-width='1.4'/>`,
    `<path d='M0 18Q5 14 10 18T20 18T30 18T40 18' fill='none' stroke='#bff1ff' stroke-opacity='0.4' stroke-width='1.4'/>`,
    dot(26, 12, 0.9, '#fff', 0.6),
    dot(6, 22, 0.7, '#fff', 0.5),
  ].join(''),
);

const MAGMA = tile(
  44,
  30,
  [
    dot(8, 22, 4, '#ffb02e', 0.55),
    dot(28, 10, 3, '#ffd34d', 0.5),
    dot(38, 25, 2.2, '#ff7a1a', 0.7),
    dot(18, 6, 1.4, '#ffe9a0', 0.8),
    `<path d='M0 15C8 11 14 19 22 15S36 11 44 15' fill='none' stroke='#ff5a1f' stroke-opacity='0.45' stroke-width='1.6'/>`,
  ].join(''),
);

const ICE = tile(
  36,
  36,
  [
    `<path d='M0 36L14 10L22 36Z' fill='#fff' fill-opacity='0.28'/>`,
    `<path d='M18 0L30 22L36 0Z' fill='#fff' fill-opacity='0.22'/>`,
    `<path d='M14 10L30 22' stroke='#ffffff' stroke-opacity='0.5' stroke-width='0.8'/>`,
    spark(28, 30, 2, '#ffffff'),
  ].join(''),
);

const TRACES = tile(
  48,
  32,
  [
    `<path d='M0 8H14L20 14H34M34 14V26H48M6 32V22H18' fill='none' stroke='#4dffd8' stroke-opacity='0.5' stroke-width='1.2'/>`,
    dot(34, 14, 1.8, '#4dffd8', 0.8),
    dot(18, 22, 1.6, '#4dffd8', 0.8),
    dot(14, 8, 1.2, '#b6fff0'),
    `<rect x='38' y='2' width='6' height='6' rx='1' fill='none' stroke='#4dffd8' stroke-opacity='0.55'/>`,
  ].join(''),
);

const PIXEL_CLOUDS = tile(
  72,
  36,
  [
    `<g fill='#fff' shape-rendering='crispEdges'>`,
    `<rect x='6' y='10' width='16' height='4'/><rect x='10' y='6' width='8' height='4'/><rect x='2' y='14' width='24' height='4'/>`,
    `<rect x='42' y='22' width='14' height='4'/><rect x='46' y='18' width='6' height='4'/><rect x='38' y='26' width='22' height='4'/>`,
    `</g>`,
    `<rect x='30' y='4' width='2' height='2' fill='#fff7a8'/><rect x='64' y='8' width='2' height='2' fill='#fff7a8'/>`,
  ].join(''),
);

const SPRINKLES = tile(
  36,
  28,
  [
    `<rect x='4' y='5' width='6' height='2' rx='1' transform='rotate(30 7 6)' fill='#ff5fa2'/>`,
    `<rect x='20' y='3' width='6' height='2' rx='1' transform='rotate(-40 23 4)' fill='#5fc8ff'/>`,
    `<rect x='28' y='18' width='6' height='2' rx='1' transform='rotate(70 31 19)' fill='#ffd84a'/>`,
    `<rect x='10' y='20' width='6' height='2' rx='1' transform='rotate(-15 13 21)' fill='#8be27a'/>`,
    dot(30, 8, 1.2, '#b388ff'),
    dot(4, 24, 1.1, '#ff8f5a'),
  ].join(''),
);

const CLOUD_STREAKS = tile(
  90,
  32,
  [
    `<path d='M6 10H38M18 16H46' stroke='#ffd7c2' stroke-opacity='0.4' stroke-width='2.4' stroke-linecap='round'/>`,
    `<path d='M54 24H84M62 6H78' stroke='#ffe3b0' stroke-opacity='0.35' stroke-width='2' stroke-linecap='round'/>`,
    `<path d='M70 14l3 -2l3 2M76 12l3 -2l3 2' fill='none' stroke='#2b1055' stroke-opacity='0.6' stroke-width='1'/>`,
  ].join(''),
);

const FILIGREE = tile(
  40,
  40,
  [
    `<path d='M0 20C6 10 14 10 20 20S34 30 40 20' fill='none' stroke='#fff3c4' stroke-opacity='0.45' stroke-width='1.2'/>`,
    `<path d='M20 4L23 8L20 12L17 8Z' fill='#fff8dc' fill-opacity='0.6'/>`,
    `<path d='M20 28L23 32L20 36L17 32Z' fill='#fff8dc' fill-opacity='0.45'/>`,
    dot(6, 32, 1, '#fff8dc', 0.6),
    dot(34, 8, 1, '#fff8dc', 0.6),
  ].join(''),
);

const MAGIC = tile(
  52,
  36,
  [
    spark(10, 10, 3, '#9fffe0'),
    spark(36, 24, 2.4, '#ff9fe6'),
    spark(46, 6, 1.6, '#ffffff'),
    dot(22, 30, 1, '#9fffe0', 0.8),
    dot(28, 8, 0.8, '#ffffff', 0.8),
    dot(4, 26, 0.8, '#ff9fe6', 0.8),
  ].join(''),
);

const GRID = tile(
  24,
  12,
  `<path d='M0 11.5H24M0.5 0V12' stroke='#ff4fd8' stroke-opacity='0.55' stroke-width='1'/>`,
);

const SKYLINE = tile(
  96,
  44,
  [
    `<g fill='#070a1f'>`,
    `<rect x='0' y='24' width='14' height='20'/><rect x='16' y='14' width='12' height='30'/><rect x='30' y='28' width='10' height='16'/>`,
    `<rect x='42' y='8' width='14' height='36'/><rect x='58' y='22' width='12' height='22'/><rect x='72' y='16' width='10' height='28'/><rect x='84' y='30' width='12' height='14'/>`,
    `</g>`,
    `<g fill='#ffd76a'>`,
    `<rect x='19' y='18' width='2' height='2'/><rect x='23' y='24' width='2' height='2'/><rect x='46' y='12' width='2' height='2'/>`,
    `<rect x='50' y='20' width='2' height='2'/><rect x='46' y='30' width='2' height='2'/><rect x='75' y='20' width='2' height='2'/>`,
    `<rect x='4' y='28' width='2' height='2'/><rect x='62' y='26' width='2' height='2'/>`,
    `</g>`,
    `<g fill='#6ff3ff'><rect x='52' y='16' width='2' height='2'/><rect x='78' y='26' width='2' height='2'/><rect x='34' y='32' width='2' height='2'/></g>`,
  ].join(''),
);

export const NAMEPLATE_ART: Readonly<Record<string, NameplateArt>> = {
  galaxy: {
    base: 'radial-gradient(120% 160% at 96% 50%, #f08ae0 0%, #8a46d0 30%, #2c1a72 62%, #120c35 100%)',
    fx: STARS,
    fxSize: '64px 40px',
    motion: 'drift',
  },
  starry: {
    base: 'radial-gradient(circle at 90% 42%, #fff6c9 0 6px, rgb(255 246 201 / 0.3) 7px 12px, transparent 13px), linear-gradient(90deg, #0c1838, #1c3170 55%, #2c4fa0)',
    fx: NIGHT_STARS,
    fxSize: '56px 40px',
    motion: 'twinkle',
  },
  meadow: {
    base: 'linear-gradient(180deg, #92d8ff 0%, #c6ecff 45%, #7fd16a 46%, #3f9a3a 100%)',
    fx: MEADOW,
    fxSize: '44px 44px',
    motion: 'drift',
  },
  sakura: {
    base: 'linear-gradient(90deg, #ffe3ee, #ffb3cf 55%, #ff7fb0)',
    fx: PETALS,
    fxSize: '48px 36px',
    motion: 'rise',
  },
  ocean: {
    base: 'linear-gradient(180deg, #0a4f8f 0%, #1170bb 50%, #22a2dc 100%)',
    fx: WAVES,
    fxSize: '40px 24px',
    motion: 'drift',
  },
  lava: {
    base: 'linear-gradient(90deg, #1a0503, #6a1408 40%, #d4380d 75%, #ff8c1a)',
    fx: MAGMA,
    fxSize: '44px 30px',
    motion: 'rise',
  },
  glacier: {
    base: 'linear-gradient(90deg, #e9f8ff, #a8dcf5 50%, #5aaedd)',
    fx: ICE,
    fxSize: '36px 36px',
    motion: 'drift',
    shine: true,
  },
  circuit: {
    base: 'linear-gradient(90deg, #04211f, #0a3d39 50%, #0f6a5f)',
    fx: TRACES,
    fxSize: '48px 32px',
    motion: 'drift',
  },
  'pixel-sky': {
    base: 'linear-gradient(180deg, #3f8cff, #86c8ff)',
    fx: PIXEL_CLOUDS,
    fxSize: '72px 36px',
    motion: 'drift',
  },
  candy: {
    base: 'repeating-linear-gradient(120deg, #ffd1ec 0 10px, #fff4fa 10px 20px, #c8f1ff 20px 30px, #fff4fa 30px 40px)',
    fx: SPRINKLES,
    fxSize: '36px 28px',
    motion: 'drift',
    shine: true,
  },
  sunset: {
    base: 'radial-gradient(circle at 90% 125%, #ffe29a 0 18px, rgb(255 226 154 / 0.35) 19px 26px, transparent 27px), linear-gradient(90deg, #2b1055 0%, #7b2d8e 35%, #e0517a 68%, #ffb347 100%)',
    fx: CLOUD_STREAKS,
    fxSize: '90px 32px',
    motion: 'drift',
  },
  gold: {
    base: 'linear-gradient(90deg, #5a3d05, #b8860b 45%, #f3d36b 78%, #fff1b8)',
    fx: FILIGREE,
    fxSize: '40px 40px',
    motion: 'drift',
    shine: true,
  },
  enchanted: {
    base: 'radial-gradient(70% 140% at 92% 50%, rgb(130 255 214 / 0.4), transparent 60%), linear-gradient(90deg, #12082a, #3b1670 50%, #6b2fb3)',
    fx: MAGIC,
    fxSize: '52px 36px',
    motion: 'rise',
  },
  synthwave: {
    base: 'radial-gradient(circle at 90% 110%, #ffd36b 0 14px, transparent 15px), linear-gradient(180deg, #1b0638 0%, #5b1a8f 45%, #ff3fa4 75%, #ffb25b 100%)',
    fx: GRID,
    fxSize: '24px 12px',
    fxPosition: '0 100%',
    motion: 'drift',
  },
  'city-lights': {
    base: 'radial-gradient(60% 120% at 95% 100%, rgb(255 79 216 / 0.45), transparent 70%), linear-gradient(180deg, #0b0f2e 0%, #1d1f5a 60%, #3a2a7a 100%)',
    fx: SKYLINE,
    fxSize: '96px 44px',
    fxPosition: '0 100%',
    motion: 'drift',
  },
};

export function nameplateArt(id: string | null | undefined): NameplateArt | null {
  return id && Object.hasOwn(NAMEPLATE_ART, id) ? NAMEPLATE_ART[id]! : null;
}
