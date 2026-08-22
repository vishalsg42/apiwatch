function risky() {
  throw new Error('boom')
}
export function real() {
  return fetch('https://api.x.dev/a')
}
export function guarded() {
  try {
    return risky()
  } catch (fetch) {
    return (fetch as unknown as (u: string) => unknown)('/x')
  }
}
