import { Anim, At, arc, heart, pt, type ArtProps } from './shapes';

function CatEar({ w, h }: { w: number; h: number }) {
  return (
    <>
      <path
        d={`M${-w / 2} 0Q${-w * 0.42} ${-h * 0.6} ${-w * 0.08} ${-h * 0.97}Q0 ${-h * 1.04} ${w * 0.08} ${-h * 0.97}Q${w * 0.42} ${-h * 0.6} ${w / 2} 0Z`}
        fill="#f59e42"
        stroke="#8f4708"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d={`M${-w * 0.27} ${-h * 0.08}Q${-w * 0.22} ${-h * 0.55} 0 ${-h * 0.78}Q${w * 0.22} ${-h * 0.55} ${w * 0.27} ${-h * 0.08}Z`}
        fill="#ffc2d1"
      />
      <path
        d={`M${-w * 0.36} ${-h * 0.3}L${-w * 0.18} ${-h * 0.42}`}
        stroke="#8f4708"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </>
  );
}

/** Tabby cat ears that twitch, and a collar with a bell. */
export function CatEars({ lite }: ArtProps) {
  const [lx, ly] = pt(45, 318);
  const [rx, ry] = pt(45, 42);
  const [bx, by] = pt(53, 180);
  return (
    <>
      <At x={lx} y={ly} rotate={-38}>
        <Anim motion="cos-twitch" delay={0.6}>
          <CatEar w={27} h={24} />
        </Anim>
      </At>
      <At x={rx} y={ry} rotate={38}>
        <Anim motion="cos-twitch">
          <CatEar w={27} h={24} />
        </Anim>
      </At>
      <path
        d={arc(51, 140, 220)}
        fill="none"
        stroke="#7a1f3d"
        strokeWidth="5.6"
        strokeLinecap="round"
      />
      <path
        d={arc(51, 140, 220)}
        fill="none"
        stroke="#e0476f"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <At x={bx} y={by + 2}>
        <Anim motion="cos-swing" duration={1.8}>
          <circle r={lite ? 6 : 5} fill="#ffd34d" stroke="#8f6300" strokeWidth="1.1" />
          <path d="M-3 1H3" stroke="#8f6300" strokeWidth="1" strokeLinecap="round" />
          <circle cy="2.6" r="1" fill="#8f6300" />
          {lite ? null : <circle cx="-1.8" cy="-2" r="1.1" fill="#fff6c9" />}
        </Anim>
      </At>
    </>
  );
}

function BunnyEar({ w, h, bent }: { w: number; h: number; bent?: boolean }) {
  const lower = bent ? h * 0.58 : h;
  const outer = (len: number) =>
    `M${-w / 2} 0C${-w * 0.62} ${-len * 0.55} ${-w * 0.45} ${-len} 0 ${-len}C${w * 0.45} ${-len} ${w * 0.62} ${-len * 0.55} ${w / 2} 0Z`;
  const inner = (len: number) =>
    `M${-w * 0.24} ${-len * 0.1}C${-w * 0.3} ${-len * 0.55} ${-w * 0.2} ${-len * 0.86} 0 ${-len * 0.86}C${w * 0.2} ${-len * 0.86} ${w * 0.3} ${-len * 0.55} ${w * 0.24} ${-len * 0.1}Z`;
  if (!bent)
    return (
      <>
        <path d={outer(h)} fill="#ffffff" stroke="#b4a2b8" strokeWidth="1.3" />
        <path d={inner(h)} fill="#ffc6dc" />
      </>
    );
  return (
    <>
      <path d={outer(lower)} fill="#ffffff" stroke="#b4a2b8" strokeWidth="1.3" />
      <path d={inner(lower)} fill="#ffc6dc" />
      <g transform={`translate(0 ${-lower * 0.88})`}>
        <Anim motion="cos-beat-r">
          <g transform="rotate(62)">
            <path d={outer(h * 0.5)} fill="#ffffff" stroke="#b4a2b8" strokeWidth="1.3" />
            <path d={inner(h * 0.5)} fill="#ffc6dc" />
          </g>
        </Anim>
      </g>
    </>
  );
}

/** Long bunny ears, one flopped over at the tip. */
export function BunnyEars(_props: ArtProps) {
  const [lx, ly] = pt(36, 334);
  const [rx, ry] = pt(36, 26);
  return (
    <>
      <At x={lx} y={ly} rotate={-20}>
        <Anim motion="cos-sway" duration={3.4}>
          <BunnyEar w={16} h={28} />
        </Anim>
      </At>
      <At x={rx} y={ry} rotate={20}>
        <Anim motion="cos-sway" delay={0.5} duration={3.4}>
          <BunnyEar w={16} h={31} bent />
        </Anim>
      </At>
    </>
  );
}

function Note({ c }: { c: string }) {
  return (
    <>
      <path
        d="M1.6 0V-8.5L6 -6.5"
        fill="none"
        stroke={c}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse
        cx="-0.4"
        cy="0.3"
        rx="2.4"
        ry="1.8"
        transform="rotate(-20)"
        fill={c}
        stroke="#2a2440"
        strokeWidth="0.5"
      />
    </>
  );
}

/** Over-ear headphones with music notes drifting up. */
export function Headphones({ lite }: ArtProps) {
  const cup = (side: -1 | 1) => (
    <At x={60 + side * 50.5} y={62}>
      <Anim motion="cos-pulse" duration={1.2} delay={side === 1 ? 0.6 : 0}>
        <rect
          x="-8"
          y="-13"
          width="16"
          height="26"
          rx="6.5"
          fill="#ff7ab6"
          stroke="#2a2440"
          strokeWidth="1.8"
        />
        <rect
          x={side === -1 ? 2 : -6.5}
          y="-9"
          width="4.5"
          height="18"
          rx="2.25"
          fill="#2a2440"
          opacity="0.85"
        />
      </Anim>
    </At>
  );
  return (
    <>
      <path
        d={arc(56, 268, 92)}
        fill="none"
        stroke="#2a2440"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      <path
        d={arc(56, 290, 70)}
        fill="none"
        stroke="#4d4670"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {cup(-1)}
      {cup(1)}
      {lite
        ? null
        : [
            { a: 38, r: 54, c: '#ff7ab6', d: 0 },
            { a: 322, r: 54, c: '#7ad7ff', d: 1.2 },
            { a: 140, r: 55, c: '#b49cff', d: 0.6 },
          ].map(({ a, r, c, d }) => {
            const [x, y] = pt(r, a);
            return (
              <At key={a} x={x} y={y}>
                <Anim motion="cos-rise" delay={d} duration={2.4}>
                  <Note c={c} />
                </Anim>
              </At>
            );
          })}
    </>
  );
}

/** A teacup on its saucer at the lower right, steam curling up, a little heart. */
export function Tea({ lite }: ArtProps) {
  const [x, y] = pt(54, 140);
  return (
    <>
      <At x={x} y={y} scale={1.2}>
        {lite
          ? null
          : [-4.5, 0, 4.5].map((dx, i) => (
              <At key={dx} x={dx} y={-12}>
                <Anim motion="cos-rise" delay={i * 0.7} duration={2.4}>
                  <path
                    d="M0 0C-2.4 -2.2 2.4 -4.4 0 -6.6C-2.4 -8.8 2.4 -11 0 -13.2"
                    fill="none"
                    stroke="#b8a596"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </Anim>
              </At>
            ))}
        <ellipse cy="9.5" rx="16" ry="3.6" fill="#fff8ef" stroke="#a8674c" strokeWidth="1.1" />
        <path
          d="M11 -4C17 -5 17 4 10 3.5"
          fill="none"
          stroke="#a8674c"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M11 -4C17 -5 17 4 10 3.5"
          fill="none"
          stroke="#fff3e6"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M-12 -7H12C12 2 7 9 0 9C-7 9 -12 2 -12 -7Z"
          fill="#fff3e6"
          stroke="#a8674c"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d="M-11.4 -2.5H11.4" stroke="#f48fb1" strokeWidth="2" />
        <ellipse cy="-7" rx="12" ry="2.6" fill="#b5651d" stroke="#a8674c" strokeWidth="1" />
      </At>
      {lite ? null : (
        <At x={pt(56, 100)[0]} y={pt(56, 100)[1]}>
          <Anim motion="cos-bob">
            <path d={heart(0, 0, 7)} fill="#ff7aa2" stroke="#9c2550" strokeWidth="0.8" />
          </Anim>
        </At>
      )}
    </>
  );
}
