// The engine is runtime-agnostic: it only needs "run this float tensor, give
// me the first output". The browser wraps onnxruntime-web; tests wrap onnxruntime-node.

export interface TensorOut {
  data: Float32Array
  dims: readonly number[]
}

export interface TensorIn {
  data: Float32Array
  dims: number[]
}

/** Any output tensor (the layout model also returns int32 counts and masks). */
export interface TensorAnyOut {
  data: Float32Array | Int32Array
  dims: readonly number[]
}

export interface InferenceModel {
  run(data: Float32Array, dims: number[]): Promise<TensorOut>
  /** Named inputs -> every output, in the model's output order (models with several inputs or outputs). */
  runAll(feeds: Record<string, TensorIn>): Promise<TensorAnyOut[]>
}
