import { Anim, At, arc, pt, seeded, sparkle, type ArtProps } from './shapes';

function flame(w: number, h: number): string {
  return `M0 0C${w * 0.62} 0 ${w * 0.62} ${-h * 0.42} ${w * 0.12} ${-h * 0.78}C${w * 0.05} ${-h * 0.86} ${w * 0.18} ${-h * 0.95} 0 ${-h}C${-w * 0.7} ${-h * 0.55} ${-w * 0.62} 0 0 0Z`;
}

/** Tongues of fire licking outward all round the rim except the very top. */
export function Flames({ uid, lite }: ArtProps) {
  const step = lite ? 40 : 24;
  const tongues: { a: number; h: number }[] = [];
  for (let a = 36; a <= 324; a += step) {
    const side = Math.abs(Math.sin((a * Math.PI) / 180));
    tongues.push({ a, h: (lite ? 17 : 12.5) + side * 6 });
  }
  return (
    <>
      <defs>
        <linearGradient id={`${uid}f`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff3d0f" />
          <stop offset="1" stopColor="#ff9e1f" />
        </linearGradient>
      </defs>
      <path
        d={arc(50, 30, 330)}
        fill="none"
        stroke="#ff6a1a"
        strokeOpacity="0.55"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {tongues.map(({ a, h }, i) => {
        const [x, y] = pt(47, a);
        // Outward, curling a little towards the top.
        const rot = a + (a < 180 ? -14 : 14);
        const w = h * 0.62;
        return (
          <At key={a} x={x} y={y} rotate={rot}>
            <Anim motion="cos-flicker" delay={(i % 4) * 0.17}>
              <path
                d={flame(w, h)}
                fill={`url(#${uid}f)`}
                stroke="#a3200a"
                strokeWidth="0.9"
                strokeLinejoin="round"
              />
              <path d={flame(w * 0.55, h * 0.6)} fill="#ffe14d" />
            </Anim>
          </At>
        );
      })}
    </>
  );
}

/** A crown of ice crystals along the top of the rim, and drifting snowflakes. */
export function Frost({ uid, lite }: ArtProps) {
  const spikes = [
    { a: -54, h: 9 },
    { a: -36, h: 12 },
    { a: -18, h: 14 },
    { a: 0, h: 16 },
    { a: 18, h: 14 },
    { a: 36, h: 12 },
    { a: 54, h: 9 },
  ];
  const flakes = lite
    ? []
    : [
        { a: 114, r: 54, s: 6.5 },
        { a: 246, r: 54, s: 6.5 },
        { a: 180, r: 55, s: 5 },
      ];
  return (
    <>
      <defs>
        <linearGradient id={`${uid}i`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#7fcff5" />
          <stop offset="1" stopColor="#f2fbff" />
        </linearGradient>
      </defs>
      {spikes.map(({ a, h }, i) => {
        const [x, y] = pt(45, a);
        const w = h * 0.42;
        return (
          <At key={a} x={x} y={y} rotate={a}>
            <path
              d={`M${-w} 0L${-w * 0.55} ${-h * 0.7}L0 ${-h}L${w * 0.55} ${-h * 0.7}L${w} 0Z`}
              fill={`url(#${uid}i)`}
              stroke="#2f86bf"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <Anim motion="cos-pulse" delay={i * 0.25}>
              <path
                d={`M${-w * 0.2} ${-h * 0.15}L0 ${-h * 0.85}`}
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </Anim>
          </At>
        );
      })}
      <path
        d={arc(49.5, 294, 66)}
        fill="none"
        stroke="#2f86bf"
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <path
        d={arc(49.5, 294, 66)}
        fill="none"
        stroke="#c6ecff"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {flakes.map(({ a, r, s }, i) => {
        const [x, y] = pt(r, a);
        return (
          <At key={a} x={x} y={y}>
            <Anim motion="cos-turn" duration={6 + i}>
              <path
                d={`M0 ${-s}V${s}M${-s * 0.87} ${-s / 2}L${s * 0.87} ${s / 2}M${-s * 0.87} ${s / 2}L${s * 0.87} ${-s / 2}`}
                stroke="#e6f7ff"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <path
                d={`M0 ${-s}V${s}M${-s * 0.87} ${-s / 2}L${s * 0.87} ${s / 2}M${-s * 0.87} ${s / 2}L${s * 0.87} ${-s / 2}`}
                stroke="#2f86bf"
                strokeOpacity="0.6"
                strokeWidth="0.7"
              />
            </Anim>
          </At>
        );
      })}
      {lite ? null : (
        <path d={sparkle(...pt(56, 76), 4.5)} fill="#ffffff" stroke="#2f86bf" strokeWidth="0.6" />
      )}
    </>
  );
}

/** A thundercloud over the top, a bolt, and rain down both sides. */
export function Storm({ lite }: ArtProps) {
  const drops = lite ? [62, 100, 260, 298] : [58, 74, 90, 106, 122, 238, 254, 270, 286, 302];
  return (
    <>
      {drops.map((a, i) => {
        const [x, y] = pt(56, a);
        return (
          <At key={a} x={x} y={y}>
            <Anim motion="cos-fall" delay={(i % 4) * 0.27}>
              <path
                d="M0 -4.6L-1.6 3.6"
                stroke="#3d8bff"
                strokeWidth={lite ? 3.4 : 2.4}
                strokeLinecap="round"
              />
            </Anim>
          </At>
        );
      })}
      <At x={91} y={16} rotate={-18}>
        <Anim motion="cos-blink" delay={0.4}>
          <path
            d="M0 0L-5 11H0.5L-3 22L8 7H2L6 0Z"
            fill="#ffd84a"
            stroke="#a0700a"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </Anim>
      </At>
      <At x={-1.6} y={3.3} scale={1.1}>
        <Anim motion="cos-swing" duration={5}>
          <path
            d="M30 17C24 17 23 9 29 8C29 2 37 0 41 4C44 -3 57 -3 60 4C64 -1 75 0 75 7C82 5 89 10 85 16C83 19 80 19 78 19H33C31.5 19 30.5 18 30 17Z"
            fill="#5f6d86"
            stroke="#2f3647"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M37 7C40 3 45 3 47 6M58 3C62 1 66 2 68 6"
            fill="none"
            stroke="#97a3ba"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </Anim>
      </At>
    </>
  );
}

/** Soap bubbles bobbing up around the rim. */
export function Bubbles({ lite }: ArtProps) {
  const rnd = seeded(31);
  const count = lite ? 7 : 13;
  const list = Array.from({ length: count }, (_, i) => {
    const a = (360 / count) * i + rnd() * 18;
    return { a, r: 52 + rnd() * 4, s: (lite ? 6 : 3.6) + rnd() * (lite ? 2.5 : 4.6), d: rnd() * 2 };
  });
  return (
    <>
      {list.map(({ a, r, s, d }) => {
        const [x, y] = pt(r, a);
        return (
          <At key={a} x={x} y={y}>
            <Anim motion="cos-bob" delay={d} duration={2 + (s % 1.5)}>
              <circle
                r={s}
                fill="#bfeeff"
                fillOpacity="0.28"
                stroke="#3bb8e6"
                strokeWidth={Math.min(1.8, s * 0.3)}
              />
              <path
                d={`M${-s * 0.55} ${-s * 0.15}A${s * 0.6} ${s * 0.6} 0 0 1 ${-s * 0.1} ${-s * 0.6}`}
                fill="none"
                stroke="#ffffff"
                strokeWidth={Math.max(0.7, s * 0.22)}
                strokeLinecap="round"
              />
            </Anim>
          </At>
        );
      })}
    </>
  );
}

function zigzagRing(seed: number, r0: number, r1: number, step: number): string {
  const rnd = seeded(seed);
  const p: string[] = [];
  for (let a = 0, i = 0; a < 360; a += step, i++) {
    const [x, y] = pt(i % 2 ? r1 + rnd() * 1.5 : r0 - rnd() * 1.5, a + rnd() * step * 0.4);
    p.push(`${x} ${y}`);
  }
  return `M${p.join('L')}Z`;
}

/** Crackling electric rings with bolts thrown off the rim. */
export function Lightning({ lite }: ArtProps) {
  const step = lite ? 18 : 10;
  const ringA = zigzagRing(3, 51, 57, step);
  const ringB = zigzagRing(11, 52, 57.5, step);
  const bolts = [
    { a: 35, s: 1 },
    { a: 160, s: 0.85 },
    { a: 262, s: 0.95 },
  ];
  return (
    <>
      <Anim motion="cos-blink">
        <path
          d={ringA}
          fill="none"
          stroke="#ffd000"
          strokeOpacity="0.4"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <path
          d={ringA}
          fill="none"
          stroke="#fff27a"
          strokeWidth={lite ? 3 : 2.2}
          strokeLinejoin="round"
        />
      </Anim>
      {lite ? null : (
        <Anim motion="cos-blink" delay={1.2}>
          <path d={ringB} fill="none" stroke="#7fe3ff" strokeWidth="1" strokeLinejoin="round" />
        </Anim>
      )}
      {bolts.map(({ a, s }, i) => {
        const [x, y] = pt(50, a);
        return (
          <At key={a} x={x} y={y} rotate={a} scale={s * 1.45}>
            <Anim motion="cos-pulse" delay={i * 0.5} duration={0.9}>
              <path
                d="M0 2L-3.5 -5H0.5L-2 -13L5.5 -3H1.5L4 2Z"
                fill="#ffe44d"
                stroke="#b36b00"
                strokeWidth="0.9"
                strokeLinejoin="round"
              />
            </Anim>
          </At>
        );
      })}
    </>
  );
}
