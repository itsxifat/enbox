import type { ReactNode } from 'react';
import { Hammer } from 'lucide-react';
import { EmptyState, type IconType } from '@/components/ui';

/**
 * Marks a screen that a feature agent will implement. Remove when the real UI lands.
 */
export function Placeholder({
  title,
  description,
  owner,
  icon = Hammer,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** e.g. "Agent 2 — chats" (shown small, for development). */
  owner?: string;
  icon?: IconType;
  children?: ReactNode;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={
        <>
          {description}
          {owner ? (
            <span className="mt-2 block text-xs text-subtle">Placeholder · {owner}</span>
          ) : null}
        </>
      }
      action={children}
    />
  );
}
