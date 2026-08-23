import { isAxiosError } from 'axios'
export const f = (e: unknown) => isAxiosError(e)
