/**
 * Prints an argon2id hash for `AUTH_PASSWORD_HASH`.
 *
 *   bun run auth:hash                 # prompts, reads stdin, echoes nothing
 *   echo -n 'secret' | bun run auth:hash
 *   bun run auth:hash 'secret'        # convenient, but the shell keeps it
 *
 * Only the hash is ever written to stdout. The password itself is never echoed,
 * never logged, and never repeated back for confirmation.
 */

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const [argument] = process.argv.slice(2);

if (argument === '--help' || argument === '-h') {
  console.log('usage: bun run auth:hash [password]   (omit the argument to read stdin)');
  process.exit(0);
}

// An argument lands in shell history and in the process list. Accepted for
// convenience, but stdin is the one that leaves no trace.
if (!argument) {
  console.error('Reading password from stdin (input is not echoed)…');
}

const password = (argument ?? (await readStdin())).replace(/\r?\n$/, '');

if (!password) {
  console.error('No password given. Pass one as an argument or pipe it on stdin.');
  process.exit(1);
}
if (password.length < 12) {
  console.error(
    `Refusing: ${password.length} characters. This is the only credential guarding real customer data — use at least 12.`
  );
  process.exit(1);
}

const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });

// Base64, not the raw PHC string: an argon2 hash is full of `$`, and `bun
// --env-file` expands those as shell variables even inside quotes, while
// Docker's `env_file` expands nothing. Encoding sidesteps the difference so the
// same .env line works in dev and in the container. See `decodePasswordHash`.
console.error('\nAdd this to .env (the password itself was never printed):\n');
console.log(`AUTH_PASSWORD_HASH=${Buffer.from(hash, 'utf8').toString('base64')}`);
