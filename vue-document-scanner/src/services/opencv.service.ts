import cvModule from '@techstark/opencv-js'
import type { CV } from '@techstark/opencv-js'

/**
 * The initialized OpenCV runtime.
 *
 * `@techstark/opencv-js` v5 exports a `Promise` that resolves to the module
 * once the runtime is initialized. Older builds exported the module directly
 * and signaled readiness through `onRuntimeInitialized`.
 */
export type OpenCV = CV & {
  onRuntimeInitialized?: () => void
}

const INIT_TIMEOUT_MS = 30_000

let cvInstance: OpenCV | null = null
let loadingPromise: Promise<OpenCV> | null = null

function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<T>).then === 'function'
  )
}

async function resolveOpenCV(): Promise<OpenCV> {
  // v5: await the module promise (it settles after the runtime is ready).
  // Pre-v5: the module is available synchronously.
  const candidate = isThenable<OpenCV>(cvModule)
    ? await cvModule
    : (cvModule as unknown as OpenCV)

  if (candidate.Mat) {
    return candidate
  }

  await new Promise<void>((resolve) => {
    candidate.onRuntimeInitialized = () => resolve()
  })

  return candidate
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('OpenCV initialization timeout'))
    }, INIT_TIMEOUT_MS)

    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export function loadOpenCV(): Promise<OpenCV> {
  if (cvInstance) {
    return Promise.resolve(cvInstance)
  }

  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = withTimeout(resolveOpenCV())
    .then((cv) => {
      cvInstance = cv
      return cv
    })
    .catch((error: unknown) => {
      // Don't cache a failed load so a later attempt can retry.
      loadingPromise = null
      throw error
    })

  return loadingPromise
}
