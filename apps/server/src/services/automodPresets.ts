/**
 * AutoMod preset word lists ("Block Commonly Flagged Words"): short, original lists per
 * category, matched like keywords (services/automod.ts: whole words, `*` = any start/end).
 * Kept modest on purpose: a Space adds its own words with a keyword rule, and the allow list
 * of the preset rule takes words back out.
 *
 * The slur list is stored ROT13-encoded so this file does not spell slurs out; `rot13()`
 * decodes it once at load (wildcards and spaces are untouched).
 */
import type { AutoModPreset } from '@enbox/shared';

/** Common swearing and insults. */
const PROFANITY = [
  '*fuck*',
  'shit*',
  '*shit',
  'bitch*',
  'asshole*',
  'bastard*',
  'dickhead*',
  'dumbass*',
  'jackass*',
  'wanker*',
  'twat*',
  'cunt*',
  'bollocks',
  'douchebag*',
];

/** Sexual content (non-graphic terms that are commonly flagged). */
const SEXUAL = [
  'porn*',
  '*porn',
  'nudes',
  'send nudes',
  'hentai',
  'xxx',
  'blowjob*',
  'handjob*',
  'dildo*',
  'sexting',
  'camgirl*',
  'cumshot*',
  'horny',
];

/** Slurs (ROT13). */
const SLURS_ROT13 = [
  'avttre*',
  'avttn*',
  'snttbg*',
  'snt',
  'sntf',
  'ergneq',
  'ergneqf',
  'ergneqrq',
  'genaal',
  'genaavrf',
  'xvxr',
  'xvxrf',
  'fcvp',
  'fcvpf',
  'puvax',
  'puvaxf',
  'jrgonpx*',
  'gbjryurnq*',
  'ornare*',
];

/** ROT13 of the ASCII letters (its own inverse). */
export function rot13(s: string): string {
  return s.replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

export const AUTOMOD_PRESET_WORDS: Readonly<Record<AutoModPreset, readonly string[]>> = {
  profanity: PROFANITY,
  sexual: SEXUAL,
  slurs: SLURS_ROT13.map(rot13),
};
