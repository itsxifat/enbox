import { UsersRound } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Avatar for the dark call surfaces: group chats without a photo get a brand gradient icon. */
export function CallAvatar({
  src,
  name,
  seed,
  group,
  size,
  className,
}: {
  src: string | null | undefined;
  name: string;
  seed: string;
  group?: boolean;
  size: number;
  className?: string;
}) {
  if (group && !src) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-violet-700 text-white',
          className,
        )}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <UsersRound size={Math.round(size * 0.46)} strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <Avatar
      src={src}
      name={name}
      colorSeed={seed}
      size={size}
      kind={group ? 'group' : 'user'}
      className={className}
    />
  );
}
