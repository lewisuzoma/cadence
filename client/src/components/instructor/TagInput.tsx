import { useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The "Areas of expertise" field from desktop artifact page 2.
 *
 * Tags in a bordered well, a free-text input after them, and an Add
 * button. Enter and comma commit; Backspace on an empty input removes the
 * last tag, which the helper text says out loud because it is otherwise
 * undiscoverable.
 *
 * Keyboard accessible throughout: each tag's remove control is a real
 * button with its own label, so a screen-reader user can hear and remove
 * them individually rather than meeting an opaque blob of text.
 */
export function TagInput({
  value,
  onChange,
  max,
  placeholder = 'Add a skill and press Enter',
  id,
  describedBy,
  invalid,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder?: string;
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '').trim();
    if (!tag) return;
    if (value.length >= max) return;
    // Case-insensitive, because "TypeScript" and "typescript" are one skill.
    if (value.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, position) => position !== index));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter must not submit the form while the user is adding tags.
      event.preventDefault();
      add(draft);
      return;
    }
    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      event.preventDefault();
      removeAt(value.length - 1);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 transition-colors',
        invalid ? 'border-destructive' : 'border-input',
        disabled && 'opacity-60',
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag, index) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-pill bg-primary-tint px-2.5 py-1 text-caption font-semibold text-primary-hover"
        >
          {tag}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              removeAt(index);
            }}
            disabled={disabled}
            aria-label={`Remove ${tag}`}
            className="rounded-full p-0.5 transition-colors hover:bg-primary/20"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}

      <input
        ref={inputRef}
        id={id}
        type="text"
        value={draft}
        disabled={disabled || value.length >= max}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        // Committing on blur as well: a user who types a tag and clicks
        // Submit would otherwise lose it without being told why.
        onBlur={() => add(draft)}
        placeholder={value.length >= max ? `Maximum of ${max}` : placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="min-w-40 flex-1 bg-transparent px-1 py-1 text-small outline-none placeholder:text-muted-foreground"
      />

      <button
        type="button"
        onClick={() => add(draft)}
        disabled={disabled || !draft.trim() || value.length >= max}
        className="rounded-md border border-border px-2.5 py-1 text-caption font-semibold transition-colors hover:bg-muted disabled:opacity-50"
      >
        Add
      </button>
    </div>
  );
}
