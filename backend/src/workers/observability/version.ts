/** Worker package version (backend package.json). Override with WORKER_VERSION. */
export function getWorkerVersion(): string {
  if (process.env.WORKER_VERSION?.trim()) {
    return process.env.WORKER_VERSION.trim();
  }
  if (process.env.npm_package_version?.trim()) {
    return process.env.npm_package_version.trim();
  }
  return '1.0.0';
}
