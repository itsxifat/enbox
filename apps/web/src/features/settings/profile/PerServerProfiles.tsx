import { useEffect, useId, useState } from 'react';
import { ChevronDown, UsersRound } from 'lucide-react';
import { Avatar, EmptyState, Spinner, toast } from '@/components/ui';
import { ServerProfileEditor } from '@/features/spaces/serverProfile/ServerProfileEditor';
import { useSpaceList, useSpaces } from '@/stores/spaces';

export const SPACE_PROFILE_UNSAVED = 'Save or reset your changes to this Space profile first.';

/**
 * Per-server Profiles: pick one of my Spaces, then edit how I appear there (the per-Space
 * editor; empty fields use the main profile). While that editor has unsaved changes the
 * picker stays on its Space; `onDirtyChange` lets the page guard navigation too.
 */
export function PerServerProfiles({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const spaces = useSpaceList();
  const loaded = useSpaces((s) => s.loaded);
  const [picked, setPicked] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const selectId = useId();

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!loaded) void useSpaces.getState().loadSpaces();
  }, [loaded]);

  const space = spaces.find((s) => s.id === picked) ?? spaces[0];

  if (!space)
    return loaded ? (
      <EmptyState
        icon={UsersRound}
        title="No Spaces yet"
        description="Join or create a Space to give it its own avatar, banner, bio and style."
      />
    ) : (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );

  return (
    <div className="flex flex-col gap-5" data-testid="per-server-profiles">
      <p className="text-[14px] leading-relaxed text-muted">
        Show a different avatar, banner, bio, pronouns, theme or decoration in each Space. Anything
        you leave empty uses your main profile.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={selectId} className="section-label">
          Choose a Space
        </label>
        <div className="card-inset relative flex max-w-md items-center gap-3 px-3 py-2 focus-within:outline-2 focus-within:outline-brand">
          <Avatar
            src={space.iconUrl}
            animatedSrc={space.iconAnimatedUrl}
            name={space.name}
            colorSeed={space.id}
            kind="community"
            size={32}
          />
          <select
            id={selectId}
            value={space.id}
            onChange={(e) => {
              if (dirty) toast.info(SPACE_PROFILE_UNSAVED);
              else setPicked(e.target.value);
            }}
            className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-6 text-[15px] font-medium text-fg outline-none"
            data-testid="space-picker"
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={18}
            className="pointer-events-none absolute right-3 text-muted"
            aria-hidden
          />
        </div>
      </div>
      <ServerProfileEditor key={space.id} spaceId={space.id} onDirtyChange={setDirty} />
    </div>
  );
}
