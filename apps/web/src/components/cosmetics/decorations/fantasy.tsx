import { Anim, At, arc, pt, sparkle, type ArtProps } from './shapes';

/** A golden halo floating over the head. */
export function Halo({ lite }: ArtProps) {
  return (
    <>
      <Anim motion="cos-bob" duration={3}>
        <ellipse cx="60" cy="9.5" rx="26" ry="7" fill="none" stroke="#ffe58a" strokeOpacity="0.4" strokeWidth={lite ? 9 : 8} />
        <Anim motion="cos-pulse" duration={3}>
          <ellipse cx="60" cy="9.5" rx="26" ry="7" fill="none" stroke="#ffc928" strokeWidth={lite ? 5.4 : 4.2} />
        </Anim>
        <ellipse cx="60" cy="9.5" rx="26" ry="7" fill="none" stroke="#a8740a" strokeOpacity="0.6" strokeWidth="0.9" />
        <path d="M37 7.6A26 7 0 0 1 83 7.6" fill="none" stroke="#fff6c9" strokeWidth="1.3" strokeLinecap="round" />
      </Anim>
      {lite
        ? null
        : [
            { x: 26, y: 15, s: 4.8, d: 0 },
            { x: 95, y: 12, s: 5.6, d: 0.7 },
            { x: 86, y: 26, s: 3.2, d: 1.3 },
          ].map(({ x, y, s, d }) => (
            <At key={x} x={x} y={y}>
              <Anim motion="cos-twinkle" delay={d}>
                <path d={sparkle(0, 0, s)} fill="#fff3b0" stroke="#a8740a" strokeWidth="0.8" />
              </Anim>
            </At>
          ))}
    </>
  );
}

const HORN = 'M-5.5 0C-5.5 -8 -8.5 -13.5 -13.5 -18C-6.5 -15.5 1.5 -10 5.5 0Z';

/** Curled devil horns that glow at the tips. */
export function Horns({ uid }: ArtProps) {
  const horn = (side: -1 | 1) => {
    const [x, y] = pt(42, side === -1 ? 326 : 34);
    return (
      <At x={x} y={y} rotate={side * 22} scale={1.4}>
        <g transform={side === 1 ? 'scale(-1 1)' : undefined}>
          <Anim motion="cos-bob" delay={side === 1 ? 0.3 : 0}>
            <path d={HORN} fill={`url(#${uid}h)`} stroke="#250404" strokeWidth="1.1" strokeLinejoin="round" />
            <path
              d="M-4.6 -4.5Q-1 -3.5 1.8 -5.2M-6.6 -9.6Q-3.8 -8.8 -1.8 -9.8"
              fill="none"
              stroke="#2a0606"
              strokeOpacity="0.6"
              strokeWidth="0.8"
              strokeLinecap="round"
            />
            <Anim motion="cos-pulse" duration={1.6}>
              <path d="M-12.6 -17.2C-10 -15.6 -8.6 -14.4 -7.6 -13.2" fill="none" stroke="#ff8a65" strokeWidth="1.3" strokeLinecap="round" />
            </Anim>
          </Anim>
        </g>
      </At>
    );
  };
  return (
    <>
      <defs>
        <linearGradient id={`${uid}h`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#e53935" />
          <stop offset="1" stopColor="#5a0d0d" />
        </linearGradient>
      </defs>
      {horn(-1)}
      {horn(1)}
    </>
  );
}

/** The crown sits tilted on the upper right of the head. */
const TILT = 30;
const GEMS = [
  { a: -30, h: 10, c: '#b28bff', l: '#ddcbff' },
  { a: -15, h: 13.5, c: '#5fd4ff', l: '#c4f0ff' },
  { a: 0, h: 17, c: '#ff5fae', l: '#ffc4e1' },
  { a: 15, h: 13.5, c: '#5fd4ff', l: '#c4f0ff' },
  { a: 30, h: 10, c: '#b28bff', l: '#ddcbff' },
];

/** A gold crown set with crystal spires, worn at a jaunty angle. */
export function Crown({ lite }: ArtProps) {
  return (
    <>
      <Anim motion="cos-bob" duration={3.2}>
        {GEMS.map(({ a, h, c, l }) => {
          const [x, y] = pt(48, TILT + a);
          const w = h * 0.36;
          return (
            <At key={a} x={x} y={y} rotate={TILT + a}>
              <path
                d={`M0 0L${-w} ${-h * 0.28}L${-w * 0.7} ${-h * 0.86}L0 ${-h}L${w * 0.7} ${-h * 0.86}L${w} ${-h * 0.28}Z`}
                fill={c}
                stroke="#3b1f73"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <path d={`M0 0L${-w} ${-h * 0.28}L${-w * 0.7} ${-h * 0.86}L0 ${-h}Z`} fill={l} opacity="0.75" />
            </At>
          );
        })}
        <path d={arc(50, TILT - 44, TILT + 44)} fill="none" stroke="#7a560a" strokeWidth="9" strokeLinecap="round" />
        <path d={arc(50, TILT - 44, TILT + 44)} fill="none" stroke="#f2c230" strokeWidth="6.6" strokeLinecap="round" />
        <path d={arc(51.8, TILT - 40, TILT + 40)} fill="none" stroke="#fff0a8" strokeWidth="1.2" strokeLinecap="round" />
        {[-22, 0, 22].map((a) => {
          const [x, y] = pt(50, TILT + a);
          return (
            <circle
              key={a}
              cx={x}
              cy={y}
              r={a === 0 ? 2.8 : 2.1}
              fill={a === 0 ? '#5fd4ff' : '#ff4fa0'}
              stroke="#5c1036"
              strokeWidth="0.6"
            />
          );
        })}
      </Anim>
      {lite
        ? null
        : [
            { a: TILT - 18, r: 62, s: 3.4, d: 0 },
            { a: TILT + 4, r: 66, s: 4.2, d: 0.6 },
            { a: TILT + 34, r: 60, s: 3, d: 1.1 },
          ].map(({ a, r, s, d }) => {
            const [x, y] = pt(r, a);
            return (
              <At key={a} x={x} y={y}>
                <Anim motion="cos-twinkle" delay={d}>
                  <path d={sparkle(0, 0, s)} fill="#ffffff" stroke="#3b1f73" strokeWidth="0.6" />
                </Anim>
              </At>
            );
          })}
    </>
  );
}

/** Flight feathers fanning up the left rim (compass angle, length), longest near the top. */
const FLIGHT = [
  { a: 232, len: 10 },
  { a: 247, len: 12.5 },
  { a: 262, len: 15 },
  { a: 277, len: 17.5 },
  { a: 292, len: 19.5 },
  { a: 307, len: 21 },
];
const COVERTS = [240, 255, 270, 285, 300];

function feather(len: number, w: number): string {
  return `M${-w * 0.5} 0Q${-w} ${-len * 0.6} 0 ${-len}Q${w * 0.9} ${-len * 0.55} ${w * 0.5} 0Z`;
}

function Wing({ lite }: { lite: boolean }) {
  const flight = lite ? FLIGHT.filter((_, i) => i % 2 === 1) : FLIGHT;
  return (
    <Anim motion="cos-beat-l">
      {flight.map(({ a, len }) => {
        const [x, y] = pt(41, a);
        // Outward from the rim, swept upwards to a wing tip at the top.
        return (
          <At key={a} x={x} y={y} rotate={a + 22}>
            <path d={feather(len, lite ? 9 : 7)} fill="#ffffff" stroke="#8f80c8" strokeWidth="1.1" strokeLinejoin="round" />
            {lite ? null : (
              <path d={`M0 -1.5L0.6 ${-len * 0.8}`} stroke="#b3a7e0" strokeWidth="0.8" strokeLinecap="round" />
            )}
          </At>
        );
      })}
      {lite
        ? null
        : COVERTS.map((a) => {
            const [x, y] = pt(41, a);
            return (
              <At key={a} x={x} y={y} rotate={a + 22}>
                <path d={feather(9, 7.5)} fill="#efe9ff" stroke="#8f80c8" strokeWidth="1" strokeLinejoin="round" />
              </At>
            );
          })}
    </Anim>
  );
}

/** Feathered wings fanning up both sides, beating slowly. */
export function Wings({ lite }: ArtProps) {
  return (
    <>
      <Wing lite={lite} />
      <g transform="translate(120 0) scale(-1 1)">
        <Wing lite={lite} />
      </g>
    </>
  );
}

const DUST = ['#ffd6f5', '#c6b8ff', '#b8f3ff', '#fff3b0'];

/** A shimmering trail of pixie dust spiralling over the top. */
export function FairyDust({ lite }: ArtProps) {
  const count = lite ? 11 : 24;
  const parts = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return { a: 205 + t * 255, r: 57 - t * 5, s: (lite ? 3 : 1.6) + (1 - t) * (lite ? 3 : 3.2), i };
  });
  return (
    <>
      {parts.map(({ a, r, s, i }) => {
        const [x, y] = pt(r, a);
        const c = DUST[i % DUST.length]!;
        return (
          <At key={i} x={x} y={y}>
            <Anim motion="cos-twinkle" delay={i * 0.07} duration={1.4}>
              {i % 3 === 0 ? (
                <path d={sparkle(0, 0, s * 1.7)} fill={c} stroke="#7a3d9e" strokeOpacity="0.65" strokeWidth="0.6" />
              ) : (
                <circle r={s * 0.6} fill={c} stroke="#7a3d9e" strokeOpacity="0.55" strokeWidth="0.5" />
              )}
            </Anim>
          </At>
        );
      })}
    </>
  );
}
