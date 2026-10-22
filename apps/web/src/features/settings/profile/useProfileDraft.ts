import { useCallback, useMemo, useState } from 'react';
import type { UserSelf } from '@enbox/shared';
import { toast } from '@/components/ui';
import { updateProfile } from '../settingsApi';
import { applyEdits, profilePatch, type DraftEdits, type ProfileDraft } from './draft';

export interface ProfileDraftApi {
  draft: ProfileDraft;
  /** Unsaved changes (what Save would send is non-empty). */
  dirty: boolean;
  saving: boolean;
  set<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]): void;
  reset(): void;
  /** One `PATCH /api/me` with only the changed fields; resolves to whether it saved. */
  save(): Promise<boolean>;
}

/**
 * The editor's draft as edits over my live profile: fields I haven't touched keep following
 * the server (another device, `me:updated`), and Reset just drops the edits.
 */
export function useProfileDraft(me: UserSelf): ProfileDraftApi {
  const [edits, setEdits] = useState<DraftEdits>({});
  const [saving, setSaving] = useState(false);
  const draft = useMemo(() => applyEdits(me, edits), [me, edits]);
  const patch = useMemo(() => profilePatch(me, draft), [me, draft]);
  const dirty = Object.keys(patch).length > 0;

  const set = useCallback(<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    setEdits((e) => ({ ...e, [key]: value }));
  }, []);
  const reset = useCallback(() => setEdits({}), []);

  const save = async () => {
    if (!dirty || saving) return false;
    setSaving(true);
    try {
      await updateProfile(patch);
      setEdits({});
      toast.success('Profile saved');
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { draft, dirty, saving, set, reset, save };
}
