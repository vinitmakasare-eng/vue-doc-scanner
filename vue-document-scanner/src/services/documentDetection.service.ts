
import { loadOpenCV } from './opencv.service'
import type { Point } from '@/types/scanner'

function orderCorners(points: Point[]): Point[] {
  const sorted = [...points].sort(
    (a, b) => a.y - b.y
  )

  const top = sorted
    .slice(0, 2)
    .sort((a, b) => a.x - b.x)

  const bottom = sorted
    .slice(2, 4)
    .sort((a, b) => a.x - b.x)

  return [
    top[0],    // Top left
    top[1],    // Top right
    bottom[1], // Bottom right
    bottom[0]  // Bottom left
  ]
}

export async function detectDocument(
  sourceCanvas: HTMLCanvasElement
): Promise<Point[] | null> {
  const cv = await loadOpenCV()

  const scale = Math.min(
    1,
    900 / Math.max(
      sourceCanvas.width,
      sourceCanvas.height
    )
  )

  const width = Math.round(sourceCanvas.width * scale)
  const height = Math.round(sourceCanvas.height * scale)

  const smallCanvas = document.createElement('canvas')

  smallCanvas.width = width
  smallCanvas.height = height

  const context = smallCanvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas context unavailable.')
  }

  context.drawImage(
    sourceCanvas,
    0,
    0,
    width,
    height
  )

  const src = cv.imread(smallCanvas)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()

  try {
    cv.cvtColor(
      src,
      gray,
      cv.COLOR_RGBA2GRAY
    )

    cv.GaussianBlur(
      gray,
      blurred,
      new cv.Size(5, 5),
      0
    )

    cv.Canny(
      blurred,
      edges,
      60,
      180
    )

    const kernel = cv.getStructuringElement(
      cv.MORPH_RECT,
      new cv.Size(3, 3)
    )

    try {
      cv.dilate(edges, edges, kernel)
    } finally {
      kernel.delete()
    }

    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    )

    let bestPolygon: Point[] | null = null
    let bestArea = width * height * 0.08

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i)

      try {
        const perimeter = cv.arcLength(
          contour,
          true
        )

        const approx = new cv.Mat()

        try {
          cv.approxPolyDP(
            contour,
            approx,
            0.02 * perimeter,
            true
          )

          if (
            approx.rows !== 4 ||
            !cv.isContourConvex(approx)
          ) {
            continue
          }

          const area = Math.abs(
            cv.contourArea(approx)
          )

          if (area <= bestArea) {
            continue
          }

          const data = approx.data32S

          const points: Point[] = [
            { x: data[0], y: data[1] },
            { x: data[2], y: data[3] },
            { x: data[4], y: data[5] },
            { x: data[6], y: data[7] }
          ]

          bestPolygon = points
          bestArea = area
        } finally {
          approx.delete()
        }
      } finally {
        contour.delete()
      }
    }

    if (!bestPolygon) {
      return null
    }

    return orderCorners(bestPolygon).map(point => ({
      x: point.x / scale,
      y: point.y / scale
    }))
  } finally {
    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    contours.delete()
    hierarchy.delete()
  }
}
