/** Mirrors the web's `humanise` rule without coupling the API to client code. */
export function extraColumnLabel(status: string): string {
  if (status === '(no status)') return 'No status';
  const words = status.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}
