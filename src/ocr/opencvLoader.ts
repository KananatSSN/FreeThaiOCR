// Statically imports OpenCV.js inside a module the worker loads lazily.
// The package's export is a Promise; awaiting `import('@techstark/opencv-js')`
// directly breaks in production builds, where CommonJS interop turns that
// Promise into a non-Promise object inheriting Promise.prototype, so awaiting the
// import calls its `then` on the wrong receiver. A plain function export avoids it.
import cvReady from '@techstark/opencv-js'

export async function loadOpenCv(): Promise<{ cv: unknown }> {
  const cv = await (cvReady as unknown as Promise<unknown>)
  return { cv } // wrapped: never hand a possibly thenable module to `await`
}
