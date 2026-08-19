import * as Switch from '@radix-ui/react-switch';
import type { ComponentPropsWithoutRef } from 'react';

export interface ToggleProps extends Omit<
  ComponentPropsWithoutRef<typeof Switch.Root>,
  'checked' | 'onCheckedChange' | 'onChange'
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ checked, onChange, className = '', ...props }: ToggleProps) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      className={`toggle-switch ${className}`.trim()}
      {...props}
    >
      <Switch.Thumb className="toggle-switch__thumb" />
    </Switch.Root>
  );
}

Toggle.displayName = 'Toggle';
