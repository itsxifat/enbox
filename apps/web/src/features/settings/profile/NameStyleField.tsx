import { NAME_EFFECTS, NAME_FONTS, type NameStyle } from '@enbox/shared';
import { StyledName } from '@/components/cosmetics';
import { Button } from '@/components/ui';
import { NameStylePreview } from '@/features/collectibles/previews';
import { cn } from '@/lib/cn';
import { ColorPicker, NAME_COLOR_PRESETS } from './ColorPicker';
import { FormSection } from './FormSection';

/** What picking a font / effect / colour starts from when I have no style yet. */
export const DEFAULT_NAME_STYLE: NameStyle = {
  font: 'default',
  effect: 'solid',
  colors: ['#8e80fd'],
};
const SECOND_COLOR = '#f472b6';

/** Merge a change into a style, keeping the colour count right for the effect (2 for gradient). */
export function nextNameStyle(current: NameStyle | null, change: Partial<NameStyle>): NameStyle {
  const merged: NameStyle = { ...(current ?? DEFAULT_NAME_STYLE), ...change };
  const first = merged.colors[0] ?? DEFAULT_NAME_STYLE.colors[0]!;
  merged.colors =
    merged.effect === 'gradient' ? [first, merged.colors[1] ?? SECOND_COLOR] : [first];
  return merged;
}

const CHIP =
  'h-8 rounded-full px-3.5 text-[13.5px] font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/**
 * Display Name Style: a font grid (each tile is my name in that font), effect chips and one
 * colour (two for gradient); "Remove style" goes back to the plain name.
 */
export function NameStyleField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: NameStyle | null;
  onChange: (style: NameStyle | null) => void;
}) {
  const style = value;
  const change = (c: Partial<NameStyle>) => onChange(nextNameStyle(style, c));
  const gradient = style?.effect === 'gradient';
  const colors = style?.colors ?? DEFAULT_NAME_STYLE.colors;

  return (
    <FormSection
      title="Display Name Style"
      hint="Your name wears its style on your profile and in member lists; messages use the font only."
      testId="name-style-field"
    >
      <NameStylePreview name={name} style={style} className="max-w-md" />

      <div role="group" aria-label="Font" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {NAME_FONTS.map((f) => {
          const on = style?.font === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              aria-label={`${f.name} font`}
              onClick={() => change({ font: f.id })}
              className={cn(
                'card-inset flex min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors outline-none hover:bg-hover',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                on && 'ring-2 ring-brand',
              )}
            >
              <StyledName
                name={name}
                style={{ font: f.id, effect: 'solid', colors: colors.slice(0, 1) }}
                mode="font"
                className="w-full truncate text-[16px] text-fg"
              />
              <span className="text-[11.5px] text-muted">{f.name}</span>
            </button>
          );
        })}
      </div>

      <div role="group" aria-label="Effect" className="flex flex-wrap gap-2">
        {NAME_EFFECTS.map((e) => {
          const on = style?.effect === e.id;
          return (
            <button
              key={e.id}
              type="button"
              aria-pressed={on}
              onClick={() => change({ effect: e.id })}
              className={cn(
                CHIP,
                on
                  ? 'bg-brand-soft text-brand-ink'
                  : 'bg-surface-2 text-muted hover:bg-line hover:text-fg',
              )}
            >
              {e.name}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColorPicker
          label={gradient ? 'Start colour' : 'Name colour'}
          value={style ? (style.colors[0] ?? null) : null}
          fallback={DEFAULT_NAME_STYLE.colors[0]}
          presets={NAME_COLOR_PRESETS}
          onChange={(c) => change({ colors: [c, ...colors.slice(1)] })}
        />
        {gradient ? (
          <ColorPicker
            label="End colour"
            value={style?.colors[1] ?? null}
            fallback={SECOND_COLOR}
            presets={NAME_COLOR_PRESETS}
            onChange={(c) => change({ colors: [colors[0]!, c] })}
          />
        ) : null}
      </div>

      {style ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove style
          </Button>
        </div>
      ) : null}
    </FormSection>
  );
}
