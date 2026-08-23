export default async function fetch(url: string, init?: { timeout?: number }) {
  return globalThis.fetch(url, { signal: AbortSignal.timeout(init?.timeout ?? 5000) })
}
