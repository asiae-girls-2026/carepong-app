import type { PetApi, CareApi } from './index'

declare global {
  interface Window {
    petApi: PetApi
    careApi: CareApi
  }
}
