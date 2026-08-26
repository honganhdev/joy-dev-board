import { Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { boardColumnOptions } from '@/lib/board-columns';
import type { Board } from '@/types';

type ColumnSettingsProps = {
  board: Board | null;
  selected: string[];
  busy: boolean;
  announcement: string;
  onToggle: (status: string, checked: boolean) => void;
};

export function ColumnSettings({
  board,
  selected,
  busy,
  announcement,
  onToggle,
}: ColumnSettingsProps) {
  const options = board ? boardColumnOptions(board) : [];

  return (
    <>
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={!board}
            aria-label={`Columns, ${selected.length} extra shown`}
          >
            <Columns3 />
            Columns · {selected.length}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <div className="border-b border-stone-100 px-1 pb-2.5">
            <h2 className="text-[13px] font-semibold">Extra columns</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Shared by everyone on this login.
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto pt-2" aria-busy={busy}>
            {options.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-muted-foreground">
                No extra statuses have open tickets.
              </p>
            ) : (
              options.map((option, index) => {
                const id = `board-column-option-${index}`;
                return (
                  <div
                    key={option.status}
                    className="flex items-center gap-2.5 rounded-md px-1 py-2 hover:bg-stone-50"
                  >
                    <Checkbox
                      id={id}
                      checked={selected.includes(option.status)}
                      onCheckedChange={(checked) => onToggle(option.status, checked === true)}
                    />
                    <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-[12px]">
                      <span className="min-w-0 flex-1 truncate" title={option.label}>
                        {option.label}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{option.count}</span>
                    </Label>
                  </div>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
