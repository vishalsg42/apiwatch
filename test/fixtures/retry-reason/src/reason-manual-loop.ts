export const f = async () => {
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch('https://v.dev/a')
    } catch {
      continue
    }
  }
}
