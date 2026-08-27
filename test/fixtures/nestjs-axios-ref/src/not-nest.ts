import axios from 'axios'

const client = axios.create({ baseURL: 'https://x.dev' })

export function nope() {
  // axios instances have no axiosRef. Reading one must not inherit the client.
  return (client as unknown as { axiosRef: typeof client }).axiosRef.get('https://x.dev/nope')
}
