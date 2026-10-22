/**
 * Invite codes share ONE space across `chats.invite_code`, `communities.invite_code`,
 * `space_invites.code` and `spaces.vanity_code` (docs "Groups → Invite links"): generate,
 * then regenerate on collision in any of them.
 */
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/index.js';
import { chats, communities, spaceInvites, spaces } from '../db/schema.js';
import { generateInviteCode } from '../lib/crypto.js';

/** A fresh invite code unused by any chat, community or Space (≈ 128 bits: collisions are practically impossible). */
export async function generateUniqueInviteCode(dbx: DbOrTx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const [c] = await dbx
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.inviteCode, code))
      .limit(1);
    if (c) continue;
    const [k] = await dbx
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.inviteCode, code))
      .limit(1);
    if (k) continue;
    const [i] = await dbx
      .select({ code: spaceInvites.code })
      .from(spaceInvites)
      .where(eq(spaceInvites.code, code))
      .limit(1);
    if (i) continue;
    const [v] = await dbx
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.vanityCode, code))
      .limit(1);
    if (!v) return code;
  }
  throw new Error('Could not generate a unique invite code');
}
