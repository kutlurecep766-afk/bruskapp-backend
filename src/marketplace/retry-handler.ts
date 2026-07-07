import { lastValueFrom, Observable } from 'rxjs'

const MAX_RETRIES = 3
const BASE_DELAY = 1000

async function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

export async function retryWithBackoff<T>(requestFn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: any
  for (let i = 0; i <= retries; i++) {
    try {
      return await requestFn()
    } catch (e: any) {
      lastError = e
      const status = e?.response?.status || e?.status
      if (status === 429 && i < retries) {
        const retryAfter = parseInt(e?.response?.headers?.['retry-after'] || String(BASE_DELAY * Math.pow(2, i)), 10)
        await delay(isNaN(retryAfter) ? BASE_DELAY * Math.pow(2, i) : retryAfter * 1000)
      }
    }
  }
  throw lastError
}

export async function httpRetry(httpObservable: () => Observable<{ data: any }>, retries = MAX_RETRIES): Promise<{ data: any }> {
  let lastError: any
  for (let i = 0; i <= retries; i++) {
    try {
      return await lastValueFrom(httpObservable())
    } catch (e: any) {
      lastError = e
      const status = e?.response?.status || e?.status
      if (status === 429 && i < retries) {
        const retryAfter = parseInt(e?.response?.headers?.['retry-after'] || String(BASE_DELAY * Math.pow(2, i)), 10)
        await delay(isNaN(retryAfter) ? BASE_DELAY * Math.pow(2, i) : retryAfter * 1000)
      }
    }
  }
  throw lastError
}
