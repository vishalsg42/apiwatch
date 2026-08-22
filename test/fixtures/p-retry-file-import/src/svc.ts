import axios from 'axios'
import pRetry from 'p-retry'

// One call is actually wrapped in the imported retry library, one is plainly not. The file-wide
// "imports a retry library anywhere" heuristic used to mark BOTH as retried, silently
// suppressing no-retry on the second (genuinely unprotected) call.
export const wrapped = () => pRetry(() => axios.get('https://x.dev/wrapped'))
export const bare = () => axios.get('https://x.dev/bare')
