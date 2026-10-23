/**
 * Settings ▸ Privacy ▸ Direct messages (W7-C): who can send me DMs, the message requests
 * filter, and DMs from members of the Spaces I join from now on (each Space has its own
 * switch: Space menu ▸ Privacy Settings). Saved through `updateSettings` (optimistic).
 */
import { useId } from 'react';
import { ChevronDown, MailQuestionMark, MessageCircle, UsersRound } from 'lucide-react';
import { DM_POLICIES, type DmPolicy } from '@enbox/shared';
import { updateMyMember } from '@/features/spaces/actions';
import { updateSettings } from '@/features/settings/settingsApi';
import { SettingsRow, SwitchRow } from '@/features/settings/ui';
import { useMe } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { confirm, toast } from '@/stores/ui';

export const DM_POLICY_LABELS: Record<DmPolicy, string> = {
  everyone: 'Everyone',
  spaces: 'Members of Spaces you share',
  friends: 'Friends only',
};

/**
 * "Allow DMs from new Spaces' members", then (Discord asks too) whether the Spaces I'm in
 * already change with it: one PATCH per Space that differs.
 */
export async function setAllowSpaceDms(allow: boolean): Promise<void> {
  if (!(await updateSettings({ allowSpaceDms: allow }))) return;
  const differ = Object.values(useSpaces.getState().byId).filter(
    (s) => (s.me.allowDms ?? true) !== allow,
  );
  if (!differ.length) return;
  const n = differ.length;
  const apply = await confirm({
    title: 'Apply to the Spaces you’re in?',
    message: `New Spaces follow this setting. Do you also want to ${allow ? 'allow' : 'stop'} direct messages from members of the ${n === 1 ? 'Space' : `${n} Spaces`} you’re already in?`,
    confirmLabel: 'Apply to existing Spaces',
    cancelLabel: 'Only new Spaces',
  });
  if (!apply) return;
  let failed = 0;
  for (const s of differ)
    await updateMyMember(s.id, { allowDms: allow }).catch(() => {
      failed++;
    });
  if (failed) toast.error(`Couldn’t update ${failed} of ${n} Spaces. Try again later.`);
}

export function DmPrivacySettings() {
  const me = useMe();
  const id = useId();
  if (!me) return null;
  const s = me.settings;
  return (
    <>
      <SettingsRow
        icon={MessageCircle}
        title={<label htmlFor={id}>Who can send you direct messages</label>}
        description="Chats you already have aren’t affected"
        testId="privacy-who-can-dm"
        end={
          <span className="relative flex shrink-0 items-center">
            <select
              id={id}
              value={s.whoCanDm}
              onChange={(e) => void updateSettings({ whoCanDm: e.target.value as DmPolicy })}
              className="cursor-pointer appearance-none rounded-lg bg-surface-2 py-1.5 pr-8 pl-3 text-[14px] font-medium text-fg outline-none focus-visible:outline-2 focus-visible:outline-brand"
            >
              {DM_POLICIES.map((v) => (
                <option key={v} value={v}>
                  {DM_POLICY_LABELS[v]}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-2 text-muted"
              aria-hidden
            />
          </span>
        }
      />
      <SwitchRow
        icon={MailQuestionMark}
        title="Message requests"
        description="Filter messages from people you may not know into Message Requests"
        checked={s.messageRequests}
        onChange={(v) => void updateSettings({ messageRequests: v })}
      />
      <SwitchRow
        icon={UsersRound}
        title="Allow DMs from new Spaces’ members"
        description="Members of the Spaces you join from now on can message you. Change it for one Space in its Privacy Settings."
        checked={s.allowSpaceDms}
        onChange={(v) => void setAllowSpaceDms(v)}
      />
    </>
  );
}
