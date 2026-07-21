// Builds the child path the directory picker navigates into. The server
// re-normalizes separators via path.resolve, so joining with '/' is safe
// cross-platform; strip a trailing separator first so a root ("C:\", "/")
// doesn't double up as "C:\/name".
export function joinChildPath(base: string, name: string): string {
  return `${base.replace(/[\\/]+$/, '')}/${name}`;
}
