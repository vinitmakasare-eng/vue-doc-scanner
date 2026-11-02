
export interface Point {
  x: number
  y: number
}

export type ScannerStep =
  | 'camera'
  | 'crop'
  | 'filter'
  | 'preview'
  | 'complete'

export type DocumentFilter =
  | 'original'
  | 'enhance'
  | 'color'
  | 'white'
  | 'contrast'
  | 'grayscale'
  | 'bw'
  | 'clean'
  | 'faded'
  | 'sharp'
  | 'invert'

export interface CameraOptions {
  width?: number
  height?: number
  facingMode?: 'user' | 'environment'
}

export interface UploadResponse {
  success?: boolean
  id?: string
  url?: string
  fileId?: string
  message?: string
  [key: string]: unknown
}

export interface ScannerState {
  step: ScannerStep
  selectedFilter: DocumentFilter
  corners: Point[]
  loading: boolean
  uploading: boolean
  error: string
}

export interface FilterOption {
  id: DocumentFilter
  name: string
  description: string
  css: string
}
