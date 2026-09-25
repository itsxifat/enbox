import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconButton, Input, type InputProps } from '@/components/ui';

/** Password field with a show/hide toggle. */
export function PasswordInput(props: Omit<InputProps, 'type' | 'rightSlot'>) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      rightSlot={
        <IconButton
          icon={visible ? EyeOff : Eye}
          label={visible ? 'Hide password' : 'Show password'}
          size="sm"
          onClick={() => setVisible((v) => !v)}
        />
      }
    />
  );
}
