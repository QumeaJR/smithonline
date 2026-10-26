import { useState } from 'react';
import { Button } from './ui/Button';

/** A button that asks once before it clears: "Clear…", then "Clear 3 curves?" with Yes and Cancel. */
export function ClearButton({
  question,
  onClear,
  disabled,
  label = 'Clear…',
}: {
  readonly question: string;
  readonly onClear: () => void;
  readonly disabled?: boolean;
  readonly label?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button size="sm" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="settings-ask" role="group" aria-label={question}>
      <span className="small">{question}</span>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          onClear();
          setAsking(false);
        }}
      >
        Yes
      </Button>
      <Button size="sm" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
