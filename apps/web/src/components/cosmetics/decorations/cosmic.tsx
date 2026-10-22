import { Anim, At, arc, pt, seeded, sparkle, type ArtProps } from './shapes';

/** Two planets and a moon on a dotted orbit around the rim. */
export function Orbit({ uid, lite }: ArtProps) {
  const [px, py] = pt(53, 45);
  const [qx, qy] = pt(53, 215);
  const [mx, my] = pt(53, 135);
  return (
    <>
      <defs>
        <radialGradient id={`${uid}p`} cx="35%" cy="35%" r="70%">
          <stop offset="0" stopColor="#d6e4ff" />
          <stop offset="1" stopColor="#3f6ee8" />
        </radialGradient>
        <radialGradient id={`${uid}q`} cx="35%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffe6b8" />
          <stop offset="1" stopColor="#f07a2c" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="53" fill="none" stroke="#8fa6ff" strokeOpacity="0.3" strokeWidth={lite ? 5 : 6} />
      <circle
        cx="60"
        cy="60"
        r="53"
        fill="none"
        stroke="#c3d0ff"
        strokeWidth={lite ? 2.6 : 1.8}
        strokeDasharray={lite ? undefined : '3 3.5'}
        strokeLinecap="round"
      />
      <Anim motion="cos-spin">
        <circle cx={px} cy={py} r="8.5" fill={`url(#${uid}p)`} stroke="#1d2f78" strokeWidth="1.3" />
        <path d={`M${px - 6.5} ${py + 1}Q${px} ${py + 4} ${px + 6.5} ${py - 1}`} fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.3" />
        <circle cx={qx} cy={qy} r="6.5" fill={`url(#${uid}q)`} stroke="#7a3510" strokeWidth="1.2" />
        <circle cx={mx} cy={my} r="3.6" fill="#eef0ff" stroke="#5b628f" strokeWidth="1" />
      </Anim>
    </>
  );
}

const STAR_COLORS = ['#ffe27a', '#ffffff', '#c3b0ff', '#8fd6ff'];

/** Twinkling sparkles scattered around the rim. */
export function Starfield({ lite }: ArtProps) {
  const rnd = seeded(7);
  const count = lite ? 7 : 13;
  const stars = Array.from({ length: count }, (_, i) => {
    const a = (360 / count) * i + rnd() * 14;
    const r = 52 + rnd() * 5;
    const s = (lite ? 6.5 : 3.8) + rnd() * (lite ? 2.5 : 4.4);
    return { a, r, s, c: STAR_COLORS[i % STAR_COLORS.length]!, d: rnd() * 1.6 };
  });
  return (
    <>
      {stars.map(({ a, r, s, c, d }, i) => {
        const [x, y] = pt(r, a);
        return (
          <At key={i} x={x} y={y}>
            <Anim motion="cos-twinkle" delay={d}>
              <path d={sparkle(0, 0, s)} fill={c} stroke="#2d2466" strokeOpacity="0.55" strokeWidth="0.8" />
            </Anim>
          </At>
        );
      })}
      {lite
        ? null
        : [20, 100, 160, 250, 300, 340].map((a, i) => {
            const [x, y] = pt(55 + (i % 2) * 2.5, a);
            return (
              <circle key={a} cx={x} cy={y} r="1.5" fill="#ffffff" stroke="#2d2466" strokeOpacity="0.45" strokeWidth="0.5" />
            );
          })}
    </>
  );
}

/** A golden crescent hugging the upper-left rim, with stars. */
export function Crescent({ uid }: ArtProps) {
  const [ax, ay] = pt(59, 210);
  const [bx, by] = pt(59, 350);
  // Outer arc on the rim, inner arc flatter: thickest (≈ 14) mid-way, tapering to points.
  const d = `M${ax} ${ay}A59 59 0 0 1 ${bx} ${by}A74 74 0 0 0 ${ax} ${ay}Z`;
  const stars = [
    { a: 28, r: 54, s: 7.5, d: 0 },
    { a: 54, r: 52, s: 4.8, d: 0.6 },
    { a: 78, r: 56, s: 3.4, d: 1.1 },
  ];
  return (
    <>
      <defs>
        <linearGradient id={`${uid}m`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset="1" stopColor="#f2b52c" />
        </linearGradient>
      </defs>
      <Anim motion="cos-rock">
        <path d={d} fill={`url(#${uid}m)`} stroke="#a8730f" strokeWidth="1.5" strokeLinejoin="round" />
        {[
          [52.5, 282, 3],
          [54.5, 306, 1.9],
          [53.5, 256, 1.6],
        ].map(([r, a, s]) => {
          const [x, y] = pt(r!, a!);
          return <circle key={a} cx={x} cy={y} r={s} fill="#e2a426" opacity="0.7" />;
        })}
      </Anim>
      {stars.map(({ a, r, s, d: delay }) => {
        const [x, y] = pt(r, a);
        return (
          <At key={a} x={x} y={y}>
            <Anim motion="cos-twinkle" delay={delay}>
              <path d={sparkle(0, 0, s)} fill="#fff4b8" stroke="#a8730f" strokeWidth="0.9" />
            </Anim>
          </At>
        );
      })}
    </>
  );
}

/** A comet racing around the rim, its tail fading behind it. */
export function Comet({ lite }: ArtProps) {
  const segments = lite ? 6 : 9;
  const head = 50;
  const [hx, hy] = pt(53, head);
  return (
    <Anim motion="cos-spin" duration={5}>
      {Array.from({ length: segments }, (_, i) => {
        const t = i / segments;
        return (
          <path
            key={i}
            d={arc(53, head - (i + 1) * 14, head - i * 14 + 2)}
            fill="none"
            stroke={i < 2 ? '#e8fbff' : '#5fc8ff'}
            strokeOpacity={0.95 * (1 - t * 0.9)}
            strokeWidth={(lite ? 12 : 10) * (1 - t * 0.75)}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={hx} cy={hy} r="12" fill="#7fd8ff" opacity="0.35" />
      <circle cx={hx} cy={hy} r="7.2" fill="#ffffff" stroke="#2aa7e8" strokeWidth="2" />
      {lite
        ? null
        : [
            [58, 18, 2.4],
            [48, 2, 1.8],
            [58, -28, 2],
          ].map(([r, a, s]) => {
            const [x, y] = pt(r!, a!);
            return <path key={a} d={sparkle(x, y, s! * 1.8)} fill="#e8fbff" stroke="#2aa7e8" strokeWidth="0.6" />;
          })}
    </Anim>
  );
}

/** A ringed planet bobbing at the lower right, with a moon and sparkles. */
export function Saturn({ uid, lite }: ArtProps) {
  const [x, y] = pt(49, 135);
  const [mx, my] = pt(56, 95);
  return (
    <>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd9a0" />
          <stop offset="0.5" stopColor="#f2a65a" />
          <stop offset="1" stopColor="#c8673a" />
        </linearGradient>
      </defs>
      <At x={x} y={y}>
        <Anim motion="cos-bob">
          <g transform="rotate(-24)">
            {/* Back half of the ring, the planet, then the front half over it. */}
            <path d="M-26 0A26 7.4 0 0 1 26 0" fill="none" stroke="#7a5a30" strokeWidth="5.4" />
            <path d="M-26 0A26 7.4 0 0 1 26 0" fill="none" stroke="#f5e3b8" strokeWidth="3.4" />
            <circle r="15" fill={`url(#${uid}s)`} stroke="#7a3d1c" strokeWidth="1.4" />
            {lite ? null : (
              <>
                <path d="M-14 -4.5Q0 -2 14 -4.5" fill="none" stroke="#fff1d6" strokeOpacity="0.55" strokeWidth="2" />
                <path d="M-14.4 4Q0 6.5 14.4 4" fill="none" stroke="#a0502a" strokeOpacity="0.45" strokeWidth="2" />
              </>
            )}
            <path d="M26 0A26 7.4 0 0 1 -26 0" fill="none" stroke="#7a5a30" strokeWidth="5.4" />
            <path d="M26 0A26 7.4 0 0 1 -26 0" fill="none" stroke="#f5e3b8" strokeWidth="3.4" />
          </g>
        </Anim>
      </At>
      <circle cx={mx} cy={my} r="3.4" fill="#e9e6ff" stroke="#5b5890" strokeWidth="0.9" />
      {[
        [54, 300, 6, 0],
        [56, 332, 4, 0.7],
        [53, 252, 3.4, 1.2],
      ].map(([r, a, s, d]) => {
        const [sx, sy] = pt(r!, a!);
        return (
          <At key={a} x={sx} y={sy}>
            <Anim motion="cos-twinkle" delay={d}>
              <path d={sparkle(0, 0, s!)} fill="#fff1c7" stroke="#8a6234" strokeWidth="0.8" />
            </Anim>
          </At>
        );
      })}
    </>
  );
}
