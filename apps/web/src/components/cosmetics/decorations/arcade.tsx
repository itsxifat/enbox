import { Anim, At, arc, pixels, pt, type ArtProps } from './shapes';

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const HEART_SHINE = ['.......', '.#.....', '.......', '.......', '.......', '.......'];
const CROSS = ['.#.', '###', '.#.'];

function PixelHeart({ p }: { p: number }) {
  return (
    <>
      <path d={pixels(HEART, p * 0.6, p * 0.6, p)} fill="#8a1030" />
      <path d={pixels(HEART, 0, 0, p)} fill="#ff4d6d" />
      <path d={pixels(HEART_SHINE, 0, 0, p)} fill="#ffc2cf" />
    </>
  );
}

/** 8-bit hearts hopping around the rim. */
export function PixelHearts({ lite }: ArtProps) {
  const hearts = [
    { a: 44, r: 51, p: 3.4, d: 0 },
    { a: 316, r: 53, p: 2.6, d: 0.35 },
    { a: 134, r: 54, p: 2.2, d: 0.7 },
    { a: 224, r: 54, p: 2, d: 1 },
    { a: 90, r: 56, p: 1.6, d: 1.3 },
  ];
  const crosses = lite
    ? []
    : [
        { a: 0, r: 56, d: 0.2 },
        { a: 88, r: 56, d: 0.9 },
        { a: 270, r: 56, d: 0.5 },
        { a: 178, r: 56, d: 1.3 },
      ];
  return (
    <>
      {hearts.map(({ a, r, p, d }) => {
        const [x, y] = pt(r, a);
        return (
          <At key={a} x={x} y={y}>
            <Anim motion="cos-hop" delay={d}>
              <PixelHeart p={lite ? p * 1.15 : p} />
            </Anim>
          </At>
        );
      })}
      {crosses.map(({ a, r, d }) => {
        const [x, y] = pt(r, a);
        return (
          <At key={a} x={x} y={y}>
            <Anim motion="cos-twinkle" delay={d}>
              <path
                d={pixels(CROSS, 0, 0, 2.2)}
                fill="#ffd6e0"
                stroke="#8a1030"
                strokeWidth="0.4"
              />
            </Anim>
          </At>
        );
      })}
    </>
  );
}

/** A game controller resting on the lower right, with floating pixel stars. */
export function Gamepad({ lite }: ArtProps) {
  const [x, y] = pt(53, 138);
  return (
    <>
      <At x={x} y={y} rotate={-18} scale={1.3}>
        <Anim motion="cos-swing" duration={2.8}>
          <path
            d="M-11 -7.5H11C15.5 -7.5 17 -4.5 17.6 -0.5L18.8 6C19.3 9.8 16 11.6 13.4 9.4L9 5.4H-9L-13.4 9.4C-16 11.6 -19.3 9.8 -18.8 6L-17.6 -0.5C-17 -4.5 -15.5 -7.5 -11 -7.5Z"
            fill="#6d5dfc"
            stroke="#1e1745"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M-9.5 -5.5H9.5" stroke="#a89eff" strokeWidth="1.2" strokeLinecap="round" />
          <path
            d="M-14 -0.5H-7.5M-10.75 -3.75V2.75"
            stroke="#f4f2ff"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="9" cy="-3" r="1.7" fill="#ff5c7a" />
          <circle cx="12.4" cy="0" r="1.7" fill="#4dd2ff" />
          <circle cx="5.6" cy="0" r="1.7" fill="#ffd24d" />
          <circle cx="9" cy="3" r="1.7" fill="#6be675" />
          {lite ? null : (
            <>
              <circle cx="-3" cy="2" r="1" fill="#1e1745" />
              <circle cx="3" cy="2" r="1" fill="#1e1745" />
            </>
          )}
        </Anim>
      </At>
      {[
        { a: 300, r: 55, p: 2.4, d: 0, c: '#ffd24d' },
        { a: 332, r: 57, p: 1.8, d: 0.5, c: '#4dd2ff' },
        { a: 266, r: 55, p: 1.7, d: 1, c: '#ff5c7a' },
        { a: 40, r: 56, p: 1.9, d: 0.8, c: '#6be675' },
      ]
        .slice(0, lite ? 2 : 4)
        .map(({ a, r, p, d, c }) => {
          const [sx, sy] = pt(r, a);
          return (
            <At key={a} x={sx} y={sy}>
              <Anim motion="cos-twinkle" delay={d}>
                <path
                  d={pixels(CROSS, 0, 0, p * (lite ? 1.4 : 1))}
                  fill={c}
                  stroke="#1e1745"
                  strokeWidth="0.5"
                />
              </Anim>
            </At>
          );
        })}
    </>
  );
}

/** RGB-split rings and torn scanline slices at the sides. */
export function Glitch({ lite }: ArtProps) {
  const slices = [
    { x: 1, y: 38, w: 13, h: 3.5, c: '#ff2bd6', d: 0 },
    { x: 4, y: 72, w: 11, h: 2.5, c: '#2be8ff', d: 0.3 },
    { x: 105, y: 29, w: 13, h: 3, c: '#2be8ff', d: 0.15 },
    { x: 101, y: 80, w: 16, h: 4, c: '#ff2bd6', d: 0.45 },
    { x: 108, y: 55, w: 10, h: 2, c: '#ffffff', d: 0.6 },
    { x: 30, y: 4, w: 18, h: 2.5, c: '#ffffff', d: 0.75 },
    { x: 70, y: 112, w: 16, h: 3, c: '#2be8ff', d: 0.2 },
  ];
  return (
    <>
      <Anim motion="cos-jitter">
        <circle
          cx="58.4"
          cy="60"
          r="52.5"
          fill="none"
          stroke="#ff2bd6"
          strokeWidth={lite ? 3.4 : 2.4}
        />
      </Anim>
      <Anim motion="cos-jitter" delay={0.45}>
        <circle
          cx="61.6"
          cy="60.6"
          r="52.5"
          fill="none"
          stroke="#2be8ff"
          strokeWidth={lite ? 3.4 : 2.4}
        />
      </Anim>
      <path
        d={arc(52.5, 200, 340)}
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.8"
        strokeWidth="1"
        strokeDasharray="10 4 3 6"
      />
      {(lite ? slices.slice(0, 4) : slices).map(({ x, y, w, h, c, d }) => (
        <Anim key={`${x}${y}`} motion="cos-jitter" delay={d} duration={0.6}>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill={c}
            stroke="#14112b"
            strokeOpacity="0.5"
            strokeWidth="0.5"
          />
        </Anim>
      ))}
    </>
  );
}

function Coin({ s }: { s: number }) {
  return (
    <>
      <circle r={s} fill="#ffcc33" stroke="#9c6b00" strokeWidth="1.1" />
      <circle r={s * 0.68} fill="none" stroke="#e6a400" strokeWidth="0.9" />
      <rect
        x={-s * 0.14}
        y={-s * 0.42}
        width={s * 0.28}
        height={s * 0.84}
        rx={s * 0.14}
        fill="#c98b00"
      />
    </>
  );
}

/** Gold coins hopping along the bottom, one spinning in the air. */
export function Coins({ lite }: ArtProps) {
  const row = lite ? [126, 158, 202, 234] : [116, 142, 168, 192, 218, 244];
  const [fx, fy] = pt(54, 42);
  return (
    <>
      {row.map((a, i) => {
        const [x, y] = pt(53, a);
        return (
          <At key={a} x={x} y={y}>
            <Anim motion="cos-hop" delay={i * 0.14}>
              <Coin s={lite ? 8.5 : 7.2} />
            </Anim>
          </At>
        );
      })}
      <At x={fx} y={fy}>
        <Anim motion="cos-flip">
          <Coin s={lite ? 9 : 8} />
        </Anim>
      </At>
      {lite
        ? null
        : [
            [56, 20],
            [57, 64],
            [55, 320],
          ].map(([r, a]) => {
            const [sx, sy] = pt(r!, a!);
            return (
              <At key={a} x={sx} y={sy}>
                <Anim motion="cos-twinkle" delay={a! / 100}>
                  <path
                    d={pixels(CROSS, 0, 0, 1.8)}
                    fill="#fff1a8"
                    stroke="#9c6b00"
                    strokeWidth="0.4"
                  />
                </Anim>
              </At>
            );
          })}
    </>
  );
}
