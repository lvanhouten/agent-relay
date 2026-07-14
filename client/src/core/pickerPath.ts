// Build the path to a child directory the directory picker navigates into.
// The server re-normalizes separators via path.resolve (Windows accepts both / and
// \), so joining with a forward slash is safe cross-platform; we only strip a
// trailing separator first so a filesystem root ("C:\" or "/") doesn't produce a
// doubled "C:\/name". The result is handed straight to GET /api/fs/browse, whose
// resolveCwd->path.resolve turns it back into the platform-native absolute path.
export function joinChildPath(base: string, name: string): string {
  return `${base.replace(/[\\/]+$/, '')}/${name}`;
}
