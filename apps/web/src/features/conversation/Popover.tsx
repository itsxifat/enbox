/**
 * The anchored popover now lives in the UI kit (`@/components/ui` Popover, with left/right
 * placements); this re-export keeps the conversation imports unchanged.
 */
export {
  Popover,
  type PopoverAlign,
  type PopoverAnchor,
  type PopoverPlacement,
  type PopoverProps,
} from '@/components/ui/Popover';
