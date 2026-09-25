import { useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { ABOUT_MAX_LENGTH, DEFAULT_ABOUT } from '@enbox/shared';
import { IconButton, Spinner, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { EditFieldModal } from '../EditFieldModal';
import { ABOUT_PRESETS, updateProfile } from '../settingsApi';
import { SettingsGroup, SettingsScroller } from '../ui';

/** Settings → Profile → About: current text (editable) and WhatsApp-style presets. */
export function AboutPage() {
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  if (!me) return null;

  const choose = async (about: string) => {
    if (about === me.about) return;
    setSaving(about);
    try {
      await updateProfile({ about });
      toast.success('About updated');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(null);
    }
  };

  const presets = [DEFAULT_ABOUT, ...ABOUT_PRESETS];

  return (
    <SettingsScroller>
      <SettingsGroup title="Currently set to">
        <div className="flex items-center gap-3 px-4 py-3.5 lg:px-5">
          <p className="min-w-0 flex-1 text-[16px] break-words text-fg" data-testid="current-about">
            {me.about || <span className="text-muted">Nothing yet</span>}
          </p>
          <IconButton icon={Pencil} label="Edit about" onClick={() => setEditing(true)} />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Select about">
        <ul aria-label="About presets" className="flex flex-col">
          {presets.map((p) => {
            const selected = p === me.about;
            return (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => void choose(p)}
                  aria-pressed={selected}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-[15.5px] text-fg hover:bg-hover lg:px-5',
                    'outline-none focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
                  )}
                >
                  <span className="min-w-0 flex-1">{p}</span>
                  {saving === p ? (
                    <Spinner size={16} label={null} />
                  ) : selected ? (
                    <Check size={18} className="text-brand-ink" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </SettingsGroup>
      <EditFieldModal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit about"
        label="About"
        initialValue={me.about}
        maxLength={ABOUT_MAX_LENGTH}
        placeholder="Available"
        onSave={async (v) => {
          await updateProfile({ about: v.trim() });
          toast.success('About updated');
        }}
      />
    </SettingsScroller>
  );
}
