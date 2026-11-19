// Where each pinned model set is served from: public/models/<key>-<rev7>/ (see scripts/fetch-models.mjs).
import models from '../../models.json'

export type ModelKey = keyof typeof models
export const modelFolder = (key: ModelKey) => {
  const { revision } = models[key]
  return `${key}-${revision ? revision.slice(0, 7) : 'local'}`
}
