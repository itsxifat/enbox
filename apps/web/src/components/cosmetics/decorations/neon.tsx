import { Anim, At, arc, mix, pt, type ArtProps } from './shapes';

/** A pink neon tube round the avatar with a cyan arc, flickering like a sign. */
export function NeonRing({ lite }: ArtProps) {
  return (
    <>
      <Anim motion="cos-neon">
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke="#ff3fd1"
          strokeOpacity="0.22"
          strokeWidth={lite ? 9 : 8}
        />
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke="#ff3fd1"
          strokeOpacity="0.75"
          strokeWidth={lite ? 4.6 : 3.4}
        />
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke="#ffe0f8"
          strokeWidth={lite ? 1.8 : 1.2}
        />
      </Anim>
      <Anim motion="cos-neon" delay={1.1} duration={4.1}>
        <path
          d={arc(58.5, 112, 196)}
          fill="none"
          stroke="#2fe0ff"
          strokeOpacity="0.3"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d={arc(58.5, 112, 196)}
          fill="none"
          stroke="#bff6ff"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </Anim>
      {lite
        ? null
        : [112, 196].map((a) => {
            const [x, y] = pt(58.5, a);
            return (
              <circle
                key={a}
                cx={x}
                cy={y}
                r="1.8"
                fill="#26203f"
                stroke="#2fe0ff"
                strokeWidth="0.6"
              />
            );
          })}
    </>
  );
}

const BANDS = ['#ff5a5f', '#ffa63d', '#ffe14d', '#5ed67b', '#4fb3ff', '#a77bff'];

function Cloud({ x, y }: { x: number; y: number }) {
  return (
    <At x={x} y={y}>
      <Anim motion="cos-bob" delay={x > 60 ? 0.6 : 0}>
        <path
          d="M-8 3C-11 3 -11 -1.5 -8 -2C-8 -5.5 -3 -6.5 -1 -4C0.5 -7.5 6.5 -7 7 -2.5C10.5 -2.5 10.5 3 7.5 3Z"
          fill="#ffffff"
          stroke="#9aa6c8"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </Anim>
    </At>
  );
}

/** A rainbow arching over the top, a cloud at each end. */
export function Rainbow({ lite }: ArtProps) {
  const width = lite ? 2.4 : 2;
  return (
    <>
      {BANDS.map((c, i) => (
        <Anim key={c} motion="cos-pulse" delay={i * 0.18} duration={2.6}>
          <path
            d={arc(59 - i * width, 272, 88)}
            fill="none"
            stroke={c}
            strokeWidth={width + 0.25}
          />
        </Anim>
      ))}
      <Cloud x={10} y={61} />
      <Cloud x={110} y={61} />
    </>
  );
}

const EQ_FROM = '#ff4fd8';
const EQ_MID = '#6d5dfc';
const EQ_TO = '#2fd9ff';

/** Equalizer bars all round the rim, bouncing to the beat. */
export function Equalizer({ lite }: ArtProps) {
  const count = lite ? 16 : 26;
  const width = lite ? 4.6 : 3.4;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const t = i / count;
        const c = t < 0.5 ? mix(EQ_FROM, EQ_MID, t * 2) : mix(EQ_MID, EQ_TO, (t - 0.5) * 2);
        const len = 5 + ((i * 7) % 5) * 1.25;
        const a = (360 / count) * i;
        return (
          <g key={i} transform={`rotate(${a} 60 60)`}>
            <Anim motion="cos-eq" delay={((i * 5) % 7) * 0.11}>
              <rect
                x={60 - width / 2}
                y={10 - len - 0.5}
                width={width}
                height={len}
                rx={width / 2}
                fill={c}
                stroke="#140f2e"
                strokeOpacity="0.45"
                strokeWidth="0.5"
              />
            </Anim>
          </g>
        );
      })}
    </>
  );
}
