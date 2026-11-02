
import type { UploadResponse } from '@/types/scanner'

const UPLOAD_URL = import.meta.env.VITE_UPLOAD_URL

export async function uploadDocument(
  canvas: HTMLCanvasElement
): Promise<UploadResponse> {
  if (!UPLOAD_URL) {
    throw new Error('Upload URL is not configured.')
  }

  const blob = await new Promise<Blob>(
    (resolve, reject) => {
      canvas.toBlob(
        result => {
          if (result) {
            resolve(result)
          } else {
            reject(
              new Error('Unable to create image file.')
            )
          }
        },
        'image/jpeg',
        0.92
      )
    }
  )

  const formData = new FormData()

  formData.append(
    'file',
    blob,
    `document-${Date.now()}.jpg`
  )

  const response = await fetch(UPLOAD_URL, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    throw new Error(
      `Upload failed: HTTP ${response.status}`
    )
  }

  return await response.json() as UploadResponse
}
