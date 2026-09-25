import { cn } from '@/lib/cn';
import { passwordStrength } from './validation';

const TONES = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];
const TEXT = ['text-danger', 'text-danger', 'text-warning', 'text-success', 'text-success'];

/** Four-segment strength bar with a label (register / change password). */
export function PasswordStrengthMeter({ password, id }: { password: string; id?: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  const filled = Math.max(1, score);
  return (
    <div id={id} className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1.5" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-200',
              i <= filled ? TONES[score] : 'bg-line',
            )}
          />
        ))}
      </div>
      <span className={cn('w-20 text-right text-[12px] font-medium', TEXT[score])}>
        {label}
        <span className="sr-only"> password</span>
      </span>
    </div>
  );
}
