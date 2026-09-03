import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchMcpDocs } from '@/lib/api';
import type { DocsBlock } from '@/types';

function DocsLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4" aria-busy="true" aria-label="Đang tải hướng dẫn MCP">
      <Skeleton className="h-10 w-72 rounded-md" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-56 w-full rounded-lg" />
      <Skeleton className="h-36 w-full rounded-lg" />
    </div>
  );
}

function DocsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-white p-6 text-center">
        <AlertTriangle className="mx-auto size-6 text-destructive" />
        <h2 className="mt-3 text-[15px] font-semibold">Không thể tải hướng dẫn MCP</h2>
        <p className="mt-1.5 text-[13px] break-words text-muted-foreground">{message}</p>
        <Button className="mt-4" size="sm" onClick={onRetry}>
          <RefreshCw />
          Thử lại
        </Button>
      </div>
    </div>
  );
}

function Block({ block }: { block: DocsBlock }) {
  switch (block.kind) {
    case 'h2':
      return (
        <h2 className="mt-12 border-t border-stone-200 pt-8 text-2xl font-bold tracking-tight first:mt-0 first:border-0 first:pt-0">
          {block.text}
        </h2>
      );
    case 'h3':
      return <h3 className="mt-8 text-lg font-semibold tracking-tight">{block.text}</h3>;
    case 'p':
      return <p className="mt-3 text-[15px] leading-7 text-stone-700">{block.text}</p>;
    case 'code':
      return (
        <div className="mt-4 max-w-full overflow-x-auto rounded-lg bg-stone-950 p-4 text-stone-100">
          <pre className="w-max min-w-full font-mono text-[13px] leading-6">
            <code>{block.text}</code>
          </pre>
        </div>
      );
    case 'table':
      return (
        <div className="mt-4 max-w-full overflow-x-auto rounded-lg border border-stone-200">
          <table className="min-w-[720px] w-full border-collapse bg-white text-left text-[13px]">
            <thead className="bg-stone-100 text-stone-800">
              <tr>
                {block.headers.map((header) => (
                  <th key={header} className="border-b border-stone-200 px-3 py-2.5 font-semibold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="align-top even:bg-stone-50/70">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${rowIndex}-${cellIndex}`}
                      className="border-b border-stone-100 px-3 py-2.5 leading-5 text-stone-700 last:border-b-0"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

export function McpDocsView() {
  const [blocks, setBlocks] = useState<readonly DocsBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestToken, setRequestToken] = useState(0);

  const reload = useCallback(() => setRequestToken((token) => token + 1), []);

  useEffect(() => {
    let current = true;
    setError(null);
    fetchMcpDocs()
      .then((next) => {
        if (current) setBlocks(next);
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Unknown error');
      });
    return () => {
      current = false;
    };
  }, [requestToken]);

  if (error) return <DocsError message={error} onRetry={reload} />;
  if (!blocks) return <DocsLoading />;

  return (
    <article lang="vi" className="mx-auto max-w-4xl rounded-lg border border-stone-200 bg-white px-8 py-10">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </article>
  );
}
