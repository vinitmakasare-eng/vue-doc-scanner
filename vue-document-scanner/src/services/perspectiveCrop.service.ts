
import { loadOpenCV } from './opencv.service'
import type { Point } from '@/types/scanner'

function distance(a: Point, b: Point): number {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y
  )
}

export async function perspectiveCrop(
  sourceCanvas: HTMLCanvasElement,
  corners: Point[]
): Promise<HTMLCanvasElement> {
  if (corners.length !== 4) {
    throw new Error('Exactly four corners are required.')
  }

  const cv = await loadOpenCV()

  const [tl, tr, br, bl] = corners

  const width = Math.round(
    Math.max(
      distance(tl, tr),
      distance(bl, br)
    )
  )

  const height = Math.round(
    Math.max(
      distance(tl, bl),
      distance(tr, br)
    )
  )

  if (width < 20 || height < 20) {
    throw new Error('Invalid document crop.')
  }

  const src = cv.imread(sourceCanvas)

  const srcPoints = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ]
  )

  const dstPoints = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    [
      0, 0,
      width - 1, 0,
      width - 1, height - 1,
      0, height - 1
    ]
  )

  const transform = cv.getPerspectiveTransform(
    srcPoints,
    dstPoints
  )

  const output = new cv.Mat()

  try {
    cv.warpPerspective(
      src,
      output,
      transform,
      new cv.Size(width, height),
      cv.INTER_CUBIC,
      cv.BORDER_REPLICATE
    )

    const canvas = document.createElement('canvas')

    canvas.width = width
    canvas.height = height

    cv.imshow(canvas, output)

    return canvas
  } finally {
    src.delete()
    srcPoints.delete()
    dstPoints.delete()
    transform.delete()
    output.delete()
  }
}
