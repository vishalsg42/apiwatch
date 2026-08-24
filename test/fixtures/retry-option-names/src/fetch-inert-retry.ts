// RequestInit has no retry key either.
export const f = () => fetch('https://v.dev/a', { retry: 3 })
