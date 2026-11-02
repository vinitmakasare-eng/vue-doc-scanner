
import { loadOpenCV } from './opencv.service'
import type { DocumentFilter } from '@/types/scanner'

function clamp(
  value: number,
  min = 0,
  max = 255
): number {
  return Math.max(min, Math.min(max, value))
}

function getOddKernel(
  dimension: number,
  fraction: number,
  minimum = 21,
  maximum = 81
): number {
  let size = Math.round(dimension * fraction)

  size = Math.max(minimum, Math.min(maximum, size))

  if (size % 2 === 0) size++

  return size
}

/**
 * Runs `use` on a temporary OpenCV Mat and always releases it
 * afterwards. Keeping pipelines as nested calls makes the
 * intermediate lifetimes explicit and leak-free.
 */
function withTemp<T extends { delete(): void }, R>(
  value: T,
  use: (value: T) => R
): R {
  try {
    return use(value)
  } finally {
    value.delete()
  }
}

/**
 * Estimate the local paper brightness.
 *
 * Estimating on a downscaled copy keeps the large blur cheap on
 * multi-megapixel phone photos while still producing a smooth
 * illumination map when scaled back up. The kernel is much wider
 * than a text stroke, so glyphs average out into the paper tone
 * instead of carving themselves into the background estimate.
 */
function estimateBackground(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  gray: InstanceType<typeof cv.Mat>
): InstanceType<typeof cv.Mat> {
  const background = new cv.Mat()
  const longestSide = Math.max(gray.cols, gray.rows)
  const scale = Math.max(1, Math.ceil(longestSide / 1000))

  if (scale === 1) {
    const kernelSize = getOddKernel(
      Math.min(gray.cols, gray.rows),
      0.12,
      21,
      121
    )

    cv.GaussianBlur(
      gray,
      background,
      new cv.Size(kernelSize, kernelSize),
      0
    )

    return background
  }

  const small = new cv.Mat()
  const blurred = new cv.Mat()

  const smallWidth = Math.max(1, Math.round(gray.cols / scale))
  const smallHeight = Math.max(1, Math.round(gray.rows / scale))

  try {
    cv.resize(
      gray,
      small,
      new cv.Size(smallWidth, smallHeight),
      0,
      0,
      cv.INTER_AREA
    )

    const kernelSize = getOddKernel(
      Math.min(smallWidth, smallHeight),
      0.15,
      15,
      81
    )

    cv.GaussianBlur(
      small,
      blurred,
      new cv.Size(kernelSize, kernelSize),
      0
    )

    cv.resize(
      blurred,
      background,
      new cv.Size(gray.cols, gray.rows),
      0,
      0,
      cv.INTER_LINEAR
    )

    return background
  } catch (error) {
    background.delete()
    throw error
  } finally {
    small.delete()
    blurred.delete()
  }
}

/**
 * Flat-field correction.
 *
 * Divide the image by the estimated paper brightness so shadows
 * and uneven phone flash disappear and the paper becomes a
 * uniform near-white surface. Because the division is a gain,
 * ink that was darker than its local paper stays darker — faint
 * text hidden by a shadow gradient becomes visible again.
 */
function flattenLighting(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  gray: InstanceType<typeof cv.Mat>
): InstanceType<typeof cv.Mat> {
  const output = new cv.Mat()

  try {
    withTemp(estimateBackground(cv, gray), (background) => {
      output.create(gray.rows, gray.cols, cv.CV_8UC1)

      const sourceData = gray.data
      const backgroundData = background.data
      const outputData = output.data

      for (let i = 0; i < sourceData.length; i++) {
        // Guard the division on completely black pixels.
        const localBackground = Math.max(backgroundData[i], 24)

        outputData[i] = clamp(
          Math.round((sourceData[i] * 248) / localBackground)
        )
      }
    })

    return output
  } catch (error) {
    output.delete()
    throw error
  }
}

/**
 * Percentile tonal stretch with an optional gamma curve.
 *
 * Fixed black/white points are fragile: the same numbers erase
 * faint pen strokes on one photo and leave a grey page on the
 * next. Instead, sample the histogram and anchor the stretch on
 * the actual paper and ink distribution. Gamma > 1 then pushes
 * mid-grey strokes towards black so faded writing gains weight,
 * while already-white paper stays white.
 */
function enhanceTone(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  source: InstanceType<typeof cv.Mat>,
  lowFraction = 0.02,
  highFraction = 0.85,
  gamma = 1
): InstanceType<typeof cv.Mat> {
  const output = source.clone()
  const data = output.data
  const histogram = new Uint32Array(256)

  for (let i = 0; i < data.length; i++) {
    histogram[data[i]]++
  }

  const total = data.length
  const lowTarget = total * lowFraction
  const highTarget = total * highFraction

  let lowValue = 0
  let highValue = 255
  let cumulative = 0

  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value]

    if (cumulative >= lowTarget) {
      lowValue = value
      break
    }
  }

  cumulative = 0

  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value]

    if (cumulative >= highTarget) {
      highValue = value
      break
    }
  }

  if (highValue <= lowValue + 8) {
    lowValue = Math.max(0, lowValue - 8)
    highValue = Math.min(255, lowValue + 24)
  }

  const range = Math.max(1, highValue - lowValue)
  const lut = new Uint8ClampedArray(256)

  for (let value = 0; value < 256; value++) {
    const normalized = clamp((value - lowValue) / range, 0, 1)

    lut[value] = clamp(
      Math.round(255 * Math.pow(normalized, gamma))
    )
  }

  for (let i = 0; i < data.length; i++) {
    data[i] = lut[data[i]]
  }

  return output
}

/**
 * Unsharp masking with a blur radius scaled to the image size.
 *
 * A fixed sigma only sharpens the finest hairline on a 12 MP
 * capture; text edges span several pixels there. Scaling sigma
 * with the short edge keeps glyph edges crisp on every camera.
 */
function sharpenImage(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  source: InstanceType<typeof cv.Mat>,
  amount = 1.4,
  sigma?: number
): InstanceType<typeof cv.Mat> {
  const output = new cv.Mat()
  const radius =
    sigma ??
    Math.max(
      1,
      Math.min(3, Math.min(source.cols, source.rows) / 1200)
    )

  try {
    withTemp(
      new cv.Mat(),
      (blurred) => {
        cv.GaussianBlur(
          source,
          blurred,
          new cv.Size(0, 0),
          radius
        )

        cv.addWeighted(
          source,
          amount,
          blurred,
          1 - amount,
          0,
          output
        )
      }
    )

    return output
  } catch (error) {
    output.delete()
    throw error
  }
}

/**
 * Normalise uneven lighting on a colour image while keeping the
 * original ink colours (stamps, signatures, highlights).
 *
 * The luminance channel estimates the local paper brightness and
 * the resulting gain is applied to R, G and B, so colour ratios
 * are preserved while the background is flattened to white.
 */
function normalizeColorBackground(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  source: InstanceType<typeof cv.Mat>
): InstanceType<typeof cv.Mat> {
  const gray = new cv.Mat()
  const output = source.clone()

  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY)

    withTemp(estimateBackground(cv, gray), (background) => {
      const outputData = output.data
      const backgroundData = background.data
      const channels = source.channels()
      const pixelCount = source.rows * source.cols

      for (let p = 0; p < pixelCount; p++) {
        const localBackground = Math.max(
          backgroundData[p],
          24
        )

        const gain = 248 / localBackground
        const base = p * channels

        // Only touch R, G and B; keep alpha intact.
        for (let c = 0; c < 3; c++) {
          outputData[base + c] = clamp(
            Math.round(outputData[base + c] * gain)
          )
        }
      }
    })

    return output
  } catch (error) {
    output.delete()
    throw error
  } finally {
    gray.delete()
  }
}

/**
 * Contrast Limited Adaptive Histogram Equalization.
 *
 * Unlike a global contrast stretch, CLAHE lifts local contrast,
 * which makes faint or shadowed text legible without blowing out
 * the highlights.
 */
function applyClahe(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  source: InstanceType<typeof cv.Mat>,
  clipLimit = 3,
  tileSize = 8
): InstanceType<typeof cv.Mat> {
  const output = new cv.Mat()
  const gridSize = new cv.Size(tileSize, tileSize)

  // Builds of opencv-js differ: some expose `createCLAHE`, others
  // only the `CLAHE` class. Fall back to global equalization if
  // neither is present.
  let clahe: {
    apply(
      src: InstanceType<typeof cv.Mat>,
      dst: InstanceType<typeof cv.Mat>
    ): void
    delete(): void
  } | null = null

  try {
    if (typeof cv.createCLAHE === 'function') {
      clahe = cv.createCLAHE(clipLimit, gridSize)
    } else if (typeof cv.CLAHE === 'function') {
      clahe = new cv.CLAHE(clipLimit, gridSize)
    }
  } catch {
    clahe = null
  }

  try {
    if (clahe) {
      clahe.apply(source, output)
    } else {
      cv.equalizeHist(source, output)
    }

    return output
  } catch (error) {
    output.delete()
    throw error
  } finally {
    clahe?.delete()
  }
}

/**
 * Adaptive threshold with a block size relative to the image.
 */
function adaptiveBinarize(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  source: InstanceType<typeof cv.Mat>,
  offset: number,
  fraction: number,
  maximumKernel: number
): InstanceType<typeof cv.Mat> {
  const output = new cv.Mat()

  const blockSize = getOddKernel(
    Math.min(source.cols, source.rows),
    fraction,
    15,
    maximumKernel
  )

  try {
    cv.adaptiveThreshold(
      source,
      output,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      blockSize,
      offset
    )

    return output
  } catch (error) {
    output.delete()
    throw error
  }
}

/**
 * Edge-preserving denoise for grainy phone captures.
 */
function bilateralDenoise(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  source: InstanceType<typeof cv.Mat>
): InstanceType<typeof cv.Mat> {
  const output = new cv.Mat()

  try {
    cv.bilateralFilter(source, output, 5, 55, 55)
    return output
  } catch (error) {
    output.delete()
    throw error
  }
}

/**
 * Median filter used to remove salt-and-pepper speckle left by
 * adaptive thresholding on textured paper.
 */
function medianClean(
  cv: Awaited<ReturnType<typeof loadOpenCV>>,
  source: InstanceType<typeof cv.Mat>,
  kernelSize = 3
): InstanceType<typeof cv.Mat> {
  const output = new cv.Mat()

  try {
    cv.medianBlur(source, output, kernelSize)
    return output
  } catch (error) {
    output.delete()
    throw error
  }
}

/**
 * Apply document-specific image processing.
 */
export async function applyFilter(
  sourceCanvas: HTMLCanvasElement,
  filter: DocumentFilter
): Promise<HTMLCanvasElement> {
  const cv = await loadOpenCV()

  const source = cv.imread(sourceCanvas)

  let output: InstanceType<typeof cv.Mat> | null = null

  try {
    if (filter === 'original') {
      output = source.clone()
    }

    // Colour enhancement works on the full RGBA image so
    // stamps, signatures and highlights keep their colour.
    else if (filter === 'color') {
      output = normalizeColorBackground(cv, source)
    }

    else {
      const gray = new cv.Mat()

      try {
        cv.cvtColor(
          source,
          gray,
          cv.COLOR_RGBA2GRAY
        )

        switch (filter) {

          // ---------------------------------
          // DOCUMENT ENHANCE
          // Paper white, deep ink, natural
          // ---------------------------------

          case 'enhance': {
            output = withTemp(flattenLighting(cv, gray), (flat) =>
              withTemp(
                enhanceTone(cv, flat, 0.02, 0.88, 1.1),
                (toned) => sharpenImage(cv, toned, 1.35)
              )
            )

            break
          }

          // ---------------------------------
          // PAPER WHITE
          // Maximum white background
          // ---------------------------------

          case 'white': {
            output = withTemp(flattenLighting(cv, gray), (flat) =>
              withTemp(
                enhanceTone(cv, flat, 0.04, 0.8, 1.18),
                (toned) => sharpenImage(cv, toned, 1.65)
              )
            )

            break
          }

          // ---------------------------------
          // HIGH CONTRAST (LOCAL)
          // CLAHE after flattening the light
          // ---------------------------------

          case 'contrast': {
            output = withTemp(flattenLighting(cv, gray), (flat) =>
              withTemp(applyClahe(cv, flat, 3, 8), (equalized) =>
                withTemp(
                  enhanceTone(cv, equalized, 0.02, 0.92, 1.05),
                  (toned) => sharpenImage(cv, toned, 1.2)
                )
              )
            )

            break
          }

          // ---------------------------------
          // GRAYSCALE
          // ---------------------------------

          case 'grayscale': {
            output = gray.clone()
            break
          }

          // ---------------------------------
          // BLACK AND WHITE CLEAN
          // Crisp binary text
          // ---------------------------------

          case 'bw': {
            output = withTemp(flattenLighting(cv, gray), (flat) =>
              withTemp(
                adaptiveBinarize(cv, flat, 9, 0.02, 71),
                (binary) => medianClean(cv, binary)
              )
            )

            break
          }

          // ---------------------------------
          // CLEAN SCAN (DENOISED B&W)
          // ---------------------------------

          case 'clean': {
            output = withTemp(flattenLighting(cv, gray), (flat) =>
              withTemp(bilateralDenoise(cv, flat), (denoised) =>
                withTemp(
                  adaptiveBinarize(cv, denoised, 8, 0.02, 71),
                  (binary) => medianClean(cv, binary)
                )
              )
            )

            break
          }

          // ---------------------------------
          // FADED TEXT
          // Steep tone curve rescues faint ink
          // ---------------------------------

          case 'faded': {
            output = withTemp(flattenLighting(cv, gray), (flat) =>
              withTemp(
                enhanceTone(cv, flat, 0.005, 0.82, 1.75),
                (toned) => sharpenImage(cv, toned, 1.25)
              )
            )

            break
          }

          // ---------------------------------
          // SHARP TEXT
          // Strong edge enhancement
          // ---------------------------------

          case 'sharp': {
            output = withTemp(flattenLighting(cv, gray), (flat) =>
              withTemp(
                enhanceTone(cv, flat, 0.02, 0.86, 1.15),
                (toned) => sharpenImage(cv, toned, 1.95)
              )
            )

            break
          }

          // ---------------------------------
          // INVERT
          // White text on black
          // ---------------------------------

          case 'invert': {
            output = withTemp(flattenLighting(cv, gray), (flat) =>
              withTemp(
                enhanceTone(cv, flat, 0.02, 0.86, 1.15),
                (toned) => {
                  const inverted = new cv.Mat()

                  try {
                    cv.bitwise_not(toned, inverted)
                    return inverted
                  } catch (error) {
                    inverted.delete()
                    throw error
                  }
                }
              )
            )

            break
          }

          default: {
            output = gray.clone()
          }
        }
      } finally {
        gray.delete()
      }
    }

    if (!output) {
      throw new Error(`Unsupported document filter: ${filter}`)
    }

    const canvas = document.createElement('canvas')

    canvas.width = output.cols
    canvas.height = output.rows

    cv.imshow(canvas, output)

    return canvas
  } finally {
    source.delete()
    output?.delete()
  }
}
