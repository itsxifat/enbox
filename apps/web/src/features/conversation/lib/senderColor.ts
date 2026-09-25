/** Deterministic sender-name colors for group bubbles, readable on both bubble themes. */
const PAIRS: [light: string, dark: string][] = [
  ['#5646e6', '#a89eff'],
  ['#0e7fc0', '#5cc1f5'],
  ['#0f8a6a', '#4fd1a5'],
  ['#c2410c', '#fb9a5b'],
  ['#be185d', '#f47fb4'],
  ['#7c3aed', '#c4a3ff'],
  ['#0f766e', '#4fd6c8'],
  ['#a16207', '#f4c14e'],
  ['#4338ca', '#9aa3ff'],
  ['#a21caf', '#ec86f5'],
  ['#15803d', '#6fdc8c'],
  ['#b91c1c', '#ff8a8a'],
];

export function senderColor(userId: string, dark: boolean): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0;
  const pair = PAIRS[Math.abs(h) % PAIRS.length]!;
  return dark ? pair[1] : pair[0];
}
