import * as React from 'react';
import { Separator as SeparatorPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Separator({
  className,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      className={cn(
        'shrink-0 bg-stone-200 data-[orientation=vertical]:h-5 data-[orientation=vertical]:w-px data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full',
        className
      )}
      {...props}
    />
  );
}

export { Separator };
