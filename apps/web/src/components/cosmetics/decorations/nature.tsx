import { Anim, At, arc, pt, type ArtProps } from './shapes';

const round = (n: number) => Math.round(n * 100) / 100;

function Flower({ s, petal, core, line }: { s: number; petal: string; core: string; line: string }) {
  return (
    <>
      {[0, 72, 144, 216, 288].map((a) => {
        const r = (a - 90) * (Math.PI / 180);
        return (
          <circle
            key={a}
            cx={round(Math.cos(r) * s * 0.52)}
            cy={round(Math.sin(r) * s * 0.52)}
            r={s * 0.46}
            fill={petal}
            stroke={line}
            strokeWidth="1"
          />
        );
      })}
      <circle r={s * 0.3} fill={core} stroke={line} strokeWidth="0.8" />
    </>
  );
}

/** A cherry branch along the lower-left rim, in bloom, shedding petals. */
export function Blossom({ lite }: ArtProps) {
  const flowers = [
    { a: 130, s: 12, d: 0 },
    { a: 170, s: 14.5, d: 0.5 },
    { a: 212, s: 11.5, d: 1 },
    { a: 250, s: 9, d: 1.4 },
    { a: 40, s: 10.5, d: 0.8 },
  ];
  const petals = lite ? [] : [{ a: 72, r: 56 }, { a: 96, r: 53 }, { a: 300, r: 56 }];
  return (
    <>
      <path d={arc(54, 116, 264)} fill="none" stroke="#6b3f2a" strokeWidth="4.4" strokeLinecap="round" />
      <path d={arc(58, 148, 192)} fill="none" stroke="#6b3f2a" strokeWidth="2.2" strokeLinecap="round" />
      <path d={arc(54, 20, 56)} fill="none" stroke="#6b3f2a" strokeWidth="3.4" strokeLinecap="round" />
      {flowers.map(({ a, s, d }) => {
        const [x, y] = pt(54, a);
        return (
          <At key={a} x={x} y={y} rotate={a}>
            <Anim motion="cos-swing" delay={d}>
              <Flower s={lite ? s * 1.1 : s} petal="#ffc2d8" core="#ffe38a" line="#c9567f" />
            </Anim>
          </At>
        );
      })}
      {petals.map(({ a, r }, i) => {
        const [x, y] = pt(r, a);
        return (
          <At key={a} x={x} y={y} rotate={a * 2}>
            <Anim motion="cos-drift" delay={i * 0.7}>
              <ellipse rx="3.8" ry="2.3" fill="#ffc2d8" stroke="#c9567f" strokeWidth="0.8" />
            </Anim>
          </At>
        );
      })}
    </>
  );
}

const LEAF = 'M0 0Q5 -6 0 -14Q-5 -6 0 0Z';
const LEAF_GREENS = ['#4caf50', '#2e8b57', '#7bc96f'];

/** Two leafy branches meeting under the avatar, tied with a ribbon. */
export function Wreath({ lite }: ArtProps) {
  const step = lite ? 22 : 15;
  const leaves: { a: number; side: 1 | -1; i: number }[] = [];
  let i = 0;
  for (let a = 194; a <= 322; a += step) leaves.push({ a, side: -1, i: i++ });
  for (let a = 166; a >= 38; a -= step) leaves.push({ a, side: 1, i: i++ });
  const [bx, by] = pt(54, 180);
  return (
    <>
      <path d={arc(53.5, 186, 326)} fill="none" stroke="#3d7a3a" strokeWidth="2.6" strokeLinecap="round" />
      <path d={arc(53.5, 34, 174)} fill="none" stroke="#3d7a3a" strokeWidth="2.6" strokeLinecap="round" />
      {leaves.map(({ a, side, i: n }) => {
        // Leaves point along the branch, towards its tip, alternating out and in.
        const out = n % 2 ? 2.6 : -2.2;
        const [x, y] = pt(53.5 + out, a);
        const rot = a + (side === -1 ? 90 : -90) + (n % 2 ? 32 : -32) * side;
        return (
          <At key={`${a}${side}`} x={x} y={y} rotate={rot} scale={lite ? 1.2 : 1}>
            <Anim motion="cos-sway" delay={(n % 5) * 0.35}>
              <path d={LEAF} fill={LEAF_GREENS[n % 3]} stroke="#1f5e36" strokeWidth="0.9" />
              <path d="M0 -1.5V-11" stroke="#1f5e36" strokeOpacity="0.45" strokeWidth="0.7" />
            </Anim>
          </At>
        );
      })}
      {lite
        ? null
        : [208, 264, 302, 152, 96, 58].map((a) => {
            const [x, y] = pt(58, a);
            return <circle key={a} cx={x} cy={y} r="2.4" fill="#e5383b" stroke="#8a1c1e" strokeWidth="0.6" />;
          })}
      <At x={bx} y={by}>
        <Anim motion="cos-bob">
          <path d="M0 0C-5 -6.5 -13 -5 -12 0C-13 5 -5 6.5 0 0Z" fill="#e5383b" stroke="#8a1c1e" strokeWidth="1" />
          <path d="M0 0C5 -6.5 13 -5 12 0C13 5 5 6.5 0 0Z" fill="#e5383b" stroke="#8a1c1e" strokeWidth="1" />
          <path d="M-1.2 1.5L-4.5 9M1.2 1.5L4.5 9" stroke="#c52a2d" strokeWidth="2.4" strokeLinecap="round" />
          <circle r="2.6" fill="#ff6b6e" stroke="#8a1c1e" strokeWidth="0.8" />
        </Anim>
      </At>
    </>
  );
}

function Sunflower({ s, uid }: { s: number; uid: string }) {
  return (
    <>
      <Anim motion="cos-turn" duration={14}>
        {Array.from({ length: 14 }, (_, i) => (
          <ellipse
            key={i}
            cx="0"
            cy={-s * 0.74}
            rx={s * 0.2}
            ry={s * 0.4}
            transform={`rotate(${round(i * (360 / 14))})`}
            fill="#ffcd1f"
            stroke="#c98a00"
            strokeWidth="0.9"
          />
        ))}
      </Anim>
      <circle r={s * 0.46} fill={`url(#${uid}c)`} stroke="#3e220e" strokeWidth="1" />
      {s > 9
        ? [0, 60, 120, 180, 240, 300].map((a) => (
            <circle
              key={a}
              cx={round(Math.cos((a * Math.PI) / 180) * s * 0.24)}
              cy={round(Math.sin((a * Math.PI) / 180) * s * 0.24)}
              r={s * 0.06}
              fill="#2b1608"
            />
          ))
        : null}
    </>
  );
}

/** A big sunflower at the top right and a small one at the lower left, with leaves. */
export function Sunflowers({ uid }: ArtProps) {
  const [x, y] = pt(52, 42);
  const [sx, sy] = pt(52, 226);
  const leaf = 'M0 0Q7 -5.5 15 0Q7 5.5 0 0Z';
  return (
    <>
      <defs>
        <radialGradient id={`${uid}c`}>
          <stop offset="0" stopColor="#8a5428" />
          <stop offset="1" stopColor="#4a2a12" />
        </radialGradient>
      </defs>
      {[
        [53, 76, 20],
        [52, 10, 200],
        [54, 250, -40],
        [53, 204, 130],
      ].map(([r, a, rot]) => {
        const [lx, ly] = pt(r!, a!);
        return (
          <At key={a} x={lx} y={ly} rotate={rot}>
            <Anim motion="cos-swing" delay={(a! % 3) * 0.4}>
              <path d={leaf} fill="#5cae4a" stroke="#2d6b25" strokeWidth="1" />
              <path d="M1.5 0H13" stroke="#2d6b25" strokeOpacity="0.5" strokeWidth="0.8" />
            </Anim>
          </At>
        );
      })}
      <At x={x} y={y}>
        <Sunflower s={16} uid={uid} />
      </At>
      <At x={sx} y={sy}>
        <Sunflower s={11} uid={uid} />
      </At>
    </>
  );
}

function Mushroom({ h, cap, dots }: { h: number; cap: string; dots: boolean }) {
  const w = h * 0.95;
  return (
    <>
      <path
        d={`M${-w * 0.17} 0L${-w * 0.14} ${-h * 0.55}H${w * 0.14}L${w * 0.17} 0Z`}
        fill="#f6ecd9"
        stroke="#9c7f5e"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d={`M${-w / 2} ${-h * 0.5}Q${-w / 2} ${-h} 0 ${-h}Q${w / 2} ${-h} ${w / 2} ${-h * 0.5}Z`}
        fill={cap}
        stroke="#7c1714"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      {dots ? (
        <>
          <circle cx={-w * 0.2} cy={-h * 0.72} r={h * 0.085} fill="#fff" />
          <circle cx={w * 0.18} cy={-h * 0.8} r={h * 0.075} fill="#fff" />
          <circle cx={w * 0.02} cy={-h * 0.61} r={h * 0.055} fill="#fff" />
        </>
      ) : null}
    </>
  );
}

/** Red-capped mushrooms in a grassy ring along the bottom of the avatar. */
export function Mushrooms({ lite }: ArtProps) {
  const shrooms = [
    { a: 120, h: 12, c: '#e53935' },
    { a: 149, h: 16, c: '#f4511e' },
    { a: 180, h: 19, c: '#e53935' },
    { a: 211, h: 15, c: '#d81b60' },
    { a: 240, h: 11, c: '#f4511e' },
  ];
  return (
    <>
      <path d={arc(54.5, 108, 252)} fill="none" stroke="#2f6b2a" strokeWidth="8" strokeLinecap="round" />
      <path d={arc(54.5, 108, 252)} fill="none" stroke="#4f9a46" strokeWidth="6" strokeLinecap="round" />
      <path d={arc(56.5, 114, 246)} fill="none" stroke="#7cc46a" strokeWidth="2" strokeLinecap="round" />
      {shrooms.map(({ a, h, c }, i) => {
        const [x, y] = pt(55, a);
        // Upright, leaning slightly with the curve of the rim.
        const lean = (a - 180) * 0.35;
        return (
          <At key={a} x={x} y={y} rotate={lean}>
            <Anim motion="cos-squash" delay={i * 0.3}>
              <Mushroom h={lite ? h * 1.1 : h} cap={c} dots={!lite} />
            </Anim>
          </At>
        );
      })}
      {lite
        ? null
        : [134, 164, 196, 226].map((a) => {
            const [x, y] = pt(57, a);
            return (
              <path
                key={a}
                d={`M${x - 2.5} ${y}L${x - 1.2} ${y - 5}L${x} ${y}L${x + 1.4} ${y - 6.5}L${x + 2.6} ${y}Z`}
                fill="#5cb85c"
                stroke="#2f6b2a"
                strokeWidth="0.6"
              />
            );
          })}
    </>
  );
}

function Butterfly({ s, wing, spot, edge, d }: { s: number; wing: string; spot: string; edge: string; d: number }) {
  return (
    <>
      <Anim motion="cos-flap-l" delay={d}>
        <path d={`M0 0C${-s} ${-s * 1.25} ${-s * 1.35} ${-s * 0.15} ${-s * 0.2} ${s * 0.1}Z`} fill={wing} stroke={edge} strokeWidth="1.1" />
        <path d={`M0 0.5C${-s * 0.95} ${s * 0.2} ${-s * 0.85} ${s * 1.05} ${-s * 0.1} ${s * 0.65}Z`} fill={wing} stroke={edge} strokeWidth="1.1" />
        <circle cx={-s * 0.55} cy={-s * 0.45} r={s * 0.16} fill={spot} />
      </Anim>
      <Anim motion="cos-flap-r" delay={d}>
        <path d={`M0 0C${s} ${-s * 1.25} ${s * 1.35} ${-s * 0.15} ${s * 0.2} ${s * 0.1}Z`} fill={wing} stroke={edge} strokeWidth="1.1" />
        <path d={`M0 0.5C${s * 0.95} ${s * 0.2} ${s * 0.85} ${s * 1.05} ${s * 0.1} ${s * 0.65}Z`} fill={wing} stroke={edge} strokeWidth="1.1" />
        <circle cx={s * 0.55} cy={-s * 0.45} r={s * 0.16} fill={spot} />
      </Anim>
      <ellipse rx={s * 0.13} ry={s * 0.6} cy={s * 0.12} fill="#2b2238" />
      <path
        d={`M0 ${-s * 0.42}Q${-s * 0.1} ${-s * 0.8} ${-s * 0.34} ${-s * 0.95}M0 ${-s * 0.42}Q${s * 0.1} ${-s * 0.8} ${s * 0.34} ${-s * 0.95}`}
        fill="none"
        stroke="#2b2238"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </>
  );
}

/** Three butterflies fluttering on the rim. */
export function Butterflies(_props: ArtProps) {
  const flies = [
    { r: 53, a: 318, s: 16, rot: -22, wing: '#8ab6ff', spot: '#ffffff', edge: '#2f4fb8', d: 0 },
    { r: 55, a: 80, s: 13.5, rot: 24, wing: '#c79bff', spot: '#ffe38a', edge: '#6a3dc4', d: 0.25 },
    { r: 55, a: 206, s: 12.5, rot: 12, wing: '#ffb35c', spot: '#ffffff', edge: '#b85a12', d: 0.4 },
  ];
  return (
    <>
      {flies.map(({ r, a, s, rot, wing, spot, edge, d }) => {
        const [x, y] = pt(r, a);
        return (
          <At key={a} x={x} y={y} rotate={rot}>
            <Anim motion="cos-float" delay={d}>
              <Butterfly s={s} wing={wing} spot={spot} edge={edge} d={d} />
            </Anim>
          </At>
        );
      })}
    </>
  );
}
