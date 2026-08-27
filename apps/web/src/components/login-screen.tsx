import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type LoginScreenProps = {
  onSubmit: (username: string, password: string) => void;
  submitting: boolean;
  /** One message for every kind of failure — see `use-auth`. */
  error: string | null;
};

/**
 * The whole app when there is no session. Nothing behind it has been fetched,
 * so there is no board to leak through the gaps.
 */
export function LoginScreen({ onSubmit, submitting, error }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const incomplete = username.trim().length === 0 || password.length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || incomplete) return;
    onSubmit(username.trim(), password);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-stone-900 text-sm font-bold text-white">
            J
          </div>
          <div className="leading-tight">
            <h1 className="text-[15px] font-bold">JOY Dev Board</h1>
            <div className="text-[11px] text-muted-foreground">Sign in to continue</div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm"
        >
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              disabled={submitting}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={submitting}
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting || incomplete}>
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          This board carries real customer data. Do not share the account.
        </p>
      </div>
    </div>
  );
}
