import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

/**
 * The actions a workspace's options rail leads with — References' "Export all
 * steps…", Simulate's "Export view…" and "Set upright" — above its sections
 * and outside the part that scrolls, so the thing you came to the rail to do
 * is never under the settings.
 *
 * The rail does not own what these act on (the diagrams, the viewport are the
 * view's), so each button runs the view's own verb through its executor; this
 * is only the shared look.
 */
export function ViewControlsActions({ children }: { children: ReactNode }) {
  return <div className="view-controls-actions">{children}</div>;
}

export function ViewControlsAction({
  icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      className="view-controls-actions__button"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}
