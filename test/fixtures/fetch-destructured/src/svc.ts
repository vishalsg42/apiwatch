export function inject({ fetch }: { fetch: (u: string) => Promise<unknown> }) {
  return fetch('/injected')
}
export function real() {
  return fetch('https://api.x.dev/a')
}
