import type { SpaceRole } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';

/** A role's icon next to a member's name: its image, else its emoji; nothing without one. */
export function RoleIcon({
  role,
  size = 16,
  className,
}: {
  role: Pick<SpaceRole, 'name' | 'iconUrl' | 'iconEmoji'> | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!role) return null;
  const url = mediaUrl(role.iconUrl ?? null);
  if (url)
    return (
      <img
        src={url}
        alt={role.name}
        title={role.name}
        width={size}
        height={size}
        draggable={false}
        className={cn('inline-block shrink-0 object-contain align-[-2px]', className)}
        style={{ width: size, height: size }}
      />
    );
  if (!role.iconEmoji) return null;
  return (
    <span
      role="img"
      aria-label={role.name}
      title={role.name}
      className={cn('inline-block shrink-0 leading-none', className)}
      style={{ fontSize: size * 0.9 }}
    >
      {role.iconEmoji}
    </span>
  );
}
