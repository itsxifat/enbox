# 64-bit permissions plan (from the 2026-10-23 scout)

Approach: JS numbers up to 2^53 (no BigInt); helpers instead of raw `& | ^ ~ <<`; int4 → int8.

## Shared (packages/shared/src/permissions.ts)
- PERM: `1 << n` for n ≤ 30; new bits `2 ** n` (31..52). ALL_PERMISSIONS = sum of PERM values.
- New helpers (hi/lo split at 2^31): permAnd, permOr(...), permAndNot(a, b) (a & ~b), permXor,
  plus hasPerm/hasAnyPerm rewritten on them. `1 << 31` is negative; `1 << 32 === 1`.
- Rewrite: RESERVED/IMPLICIT/ASSIGNABLE (60-72), VOICE/TEXT_ONLY/SPACE_ONLY/TIMED_OUT_KEEP/DEFAULT_EVERYONE
  chains (75-128), hasPerm 131, hasAnyPerm 135, permissionNames 140, computeBasePermissions 176-178,
  computeChannelPermissions 194-220, isSpaceAdmin 230, grantableBits 284-286.
- schemas.ts 820 `(v & ~ASSIGNABLE) === 0`, 887 `(o.allow & o.deny) === 0` → helpers; keep `.int().min(0)`.

## Server raw ops (non-test)
- modules/spaces/routes.ts 676-677, 728, 1042, 1090 (assertGrantable xor/or), 1160 VIEW_AFFECTING, 1293, 1314
- modules/spaces/service.ts 97, 186
- services/spaces.ts 792, 809, 822, 823 (applyTemplateTx masks)
- modules/automod/routes.ts 78, 171, 172
- realtime/spaceRegistry.ts 90
- modules/search/service.ts 66-69
- modules/moderation/service.ts 69-74 (MODERATOR_BITS), modules/reports/service.ts 59-60
- services/spacesMigration.ts 47; ORs into helpers: spaceRules.ts 59, threads/service.ts 333,
  insights/service.ts 37, voice/service.ts 205

## Web raw ops
- features/spaces/settings/RolesPage.tsx 594-596 (toggle), ChannelDialog.tsx 612-618 (tri-state)
- features/voice/actions.ts 78

## DB (all `integer` today) → `bigint(..., { mode: 'number' })`
- space_roles.permissions (+ check >= 0), space_channel_overwrites.allow/deny, space_category_overwrites.allow/deny
  (+ check (allow & deny) = 0 — PG & on bigint is fine). jsonb: space_templates.snapshot, space_audit_log.changes.
- node-postgres INT8 parser already Number (db/index.ts 68-71); PGlite returns Number in safe range.
- Rolling deploy: old code reads int8 as Number → OK as long as no bit ≥ 2^31 is written before both instances run new code.

## Tests hard-coding values
- shared permissions.test.ts 64-67, 143, 167-169, 244, 252, 276
- server spaces/stage.test.ts, templates.test.ts, voiceText.test.ts (`spacePermissions! & PERM.X`), moderation/community/preview/spaces tests (| ~ combos)
- web: 0x7fffffff as "all": realtime/reactions.test.ts 84,109; features/events/testUtils.ts 27; features/spaces/testUtils.ts 2,48; StickerPicker.test.tsx 11,62,140; ~30 files use `PERM.A | PERM.B` (fine below 2^31)

## mobile/
No Space bit checks; Metro bundles shared — frozen old helpers keep low bits correct (ToInt32).

## Stand-in checks to replace with new bits
| New bit | Server (current) | Web (current) |
| PIN_MESSAGES | utils.ts 227,232 canPin=MANAGE_MESSAGES → chats/service.ts 605,661; threads/service.ts 232 | conversation/actions.ts 124, pins/PinsPopout.tsx 87, PinnedBar.tsx 112, stores/threads.ts 504 |
| MANAGE_THREADS | threads/service.ts 226-232 (MANAGE_MESSAGES), delete 333, locked send spaceAccess.ts 322, moderated tags forums/service.ts 143 | stores/threads.ts 117,497-505; forums/NewPostComposer.tsx 120 |
| CREATE_PUBLIC_THREADS | threads/service.ts 87 (SEND_MESSAGES) | threads/actions.ts 39, ThreadsButton.tsx 119 |
| SEND_MESSAGES_IN_THREADS | spaceAccess.ts 315-323 → utils.ts 230; chats/socket.ts 39 | stores/threads.ts 115-118 |
| BYPASS_SLOWMODE | spaceRules.ts 59 | none |
| USE_SOUNDBOARD | soundboard/service.ts 242 (SPEAK) | SoundboardButton.tsx 20-23 |
| USE_EXTERNAL_SOUNDS | soundboard/service.ts 234-243 ungated | SoundboardPicker.tsx 65 |
| USE_EXTERNAL_STICKERS | stickers/service.ts 355 (USE_EXTERNAL_EMOJI) | stickers/groups.ts 28 |
| SEND_TTS_MESSAGES | messages/service.ts 286 ungated | commands/commands.ts 83-88, Composer.tsx 509 |
| REQUEST_TO_SPEAK | voice/service.ts 505 (SPEAK) | voice/StageChannelView.tsx 182 |
| CREATE_EVENTS | events/service.ts 485-490 (MANAGE_CHANNELS) | stores/events.ts 202-204 |
| MANAGE_EVENTS | events/service.ts 365 (creator or MANAGE_SPACE) | stores/events.ts 208-213 |
| CREATE_EXPRESSIONS | MANAGE_EMOJI: spaces/emojis.ts 121,167,197; stickers/service.ts 174,219,257; soundboard/service.ts 118,161,189 | settings/sections.ts 42-44; SoundboardPicker.tsx 91 |
| VIEW_INSIGHTS | insights/service.ts 37 | settings/sections.ts 54 |
| SEND_VOICE_MESSAGES | spaceRules.ts 22,54 (ATTACH_FILES) | Composer.tsx 834 → dropzone/files.ts 19-20 |
| USE_VOICE_ACTIVITY | no gate; voice/service.ts 141-146 | stores/ui.ts voiceInputMode |
| SET_VOICE_CHANNEL_STATUS | voice/status.ts 52 (SPEAK) | voice/actions.ts 45 |
Also: READ_MESSAGE_HISTORY and PRIORITY_SPEAKER reserved/unenforced (search/service.ts 62-69).

## Editors
- labels: features/spaces/permissionLabels.ts 25-95 (PERMISSION_GROUPS, 29 items; channelOnly flags)
- role editor RolesPage.tsx 366-603; overwrite editor ChannelDialog.tsx 577-745 (no grantable gating on client); no category overwrite editor on web; Mod View KEY_PERMISSIONS moderation/labels.ts 88-105.

## Data migration for new bits (defaults like Discord)
- Roles/overwrites with MANAGE_MESSAGES gain MANAGE_THREADS + PIN_MESSAGES (+ BYPASS_SLOWMODE with MANAGE_CHANNELS too).
- @everyone gains CREATE_PUBLIC_THREADS, SEND_MESSAGES_IN_THREADS, USE_EXTERNAL_STICKERS, SEND_TTS? (Discord default: no TTS for new servers? decide), REQUEST_TO_SPEAK, USE_SOUNDBOARD, USE_EXTERNAL_SOUNDS, SEND_VOICE_MESSAGES, USE_VOICE_ACTIVITY, SET_VOICE_CHANNEL_STATUS, CREATE_EVENTS?, CREATE_EXPRESSIONS? (Discord gives @everyone Create Expressions and Create Events by default in new servers).
- Overwrites that DENY the stand-in bit should deny the new one too (e.g. deny SEND_MESSAGES → deny SEND_MESSAGES_IN_THREADS and CREATE_PUBLIC_THREADS; deny SPEAK → deny USE_SOUNDBOARD, REQUEST_TO_SPEAK? careful) so behaviour doesn't loosen.
