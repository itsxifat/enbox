import { clsx, type ClassValue } from 'clsx';

/**
 * Join class names (clsx). Note: there is no tailwind-merge — when a component accepts a
 * `className` override, avoid passing utilities that conflict with its defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
