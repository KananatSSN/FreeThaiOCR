// The engine is runtime-agnostic: it only needs "run this float tensor, give
// me the first output". The browser wraps onnxruntime-web; tests wrap onnxruntime-node.

export interface TensorOut {
  data: Float32Array
  dims: readonly number[]
}

export interface InferenceModel {
  run(data: Float32Array, dims: number[]): Promise<TensorOut>
}
