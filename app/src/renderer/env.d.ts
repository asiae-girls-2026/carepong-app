/// <reference types="vite/client" />
import type { PetApi, CareApi } from '../preload/index'

declare global {
  interface Window {
    petApi: PetApi
    careApi: CareApi
  }
}
