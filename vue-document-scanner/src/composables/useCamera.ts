
import { ref, onUnmounted } from 'vue'
import type { Ref } from 'vue'
import type { CameraOptions } from '@/types/scanner'

export async function getBestBackCamera(): Promise<MediaDeviceInfo | null> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const backCameras = devices.filter(
    (d) => d.kind === "videoinput" && d.label.toLowerCase().includes("back"),
  );

  if (!backCameras.length) return null;

  const mainBack = backCameras.find((d) => d.label.toLowerCase().includes("0"));

  return mainBack || null;
}

type FocusMode =
  | 'continuous'
  | 'single-shot'
  | 'auto'
  | 'manual'
  | 'none'

type FocusCapabilities = MediaTrackCapabilities & {
  focusMode?: FocusMode[]
}

type FocusSettings = MediaTrackSettings & {
  focusMode?: FocusMode
}

/**
 * Enable continuous autofocus when the camera supports it and is
 * not already focusing automatically.
 *
 * Note: the Web spec calls autofocus "continuous" (there is no
 * "auto" value), though some builds report "auto", so both are
 * treated as already-focused.
 */
async function ensureAutoFocus(
  stream: MediaStream
): Promise<void> {
  const track = stream.getVideoTracks()[0]

  if (!track) return

  const current = (track.getSettings() as FocusSettings)
    .focusMode

  if (current === 'continuous' || current === 'auto') {
    return
  }

  const supported =
    (track.getCapabilities?.() as FocusCapabilities)
      ?.focusMode ?? []

  // Prefer continuous autofocus, then "auto", then a single
  // focus pass. If capabilities are not reported, try continuous.
  const target: FocusMode | null = supported.length
    ? supported.includes('continuous')
      ? 'continuous'
      : supported.includes('auto')
        ? 'auto'
        : supported.includes('single-shot')
          ? 'single-shot'
          : null
    : 'continuous'

  if (!target) return

  try {
    await track.applyConstraints({
      advanced: [{ focusMode: target }]
    } as unknown as MediaTrackConstraints)
  } catch {
    // Autofocus is best-effort; ignore devices that reject it.
  }
}

export function useCamera() {
  const video: Ref<HTMLVideoElement | null> = ref(null)

  const stream: Ref<MediaStream | null> = ref(null)

  const cameraError = ref('')
  const isCameraActive = ref(false)

  // Real aspect ratio of the incoming stream, so the preview can be
  // sized to the full frame instead of a fixed (cropping) box.
  const videoAspectRatio = ref<string | null>(null)

  function updateAspectRatio(): void {
    const el = video.value
    if (!el?.videoWidth || !el.videoHeight) return
    videoAspectRatio.value = `${el.videoWidth} / ${el.videoHeight}`
  }

  async function startCamera(
    options: CameraOptions = {}
  ): Promise<void> {
    try {
      cameraError.value = ''

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera is not supported in this browser.'
        )
      }

      stopCamera()

      const bestBackCamera = await getBestBackCamera()

      const mediaStream =
        await navigator.mediaDevices.getUserMedia(
          bestBackCamera
            ? {
                video: {
                  deviceId: {
                    exact: bestBackCamera.deviceId
                  },
                  width: { ideal: options.width ?? 1920 },
                  height: { ideal: options.height ?? 1080 }
                }
              }
            : {
                video: {
                  facingMode:
                    options.facingMode ?? 'environment',
                  width: { ideal: options.width ?? 1920 },
                  height: { ideal: options.height ?? 1080 }
                }
              }
        )

      stream.value = mediaStream

      if (!video.value) {
        stopCamera()
        throw new Error('Video element is not available.')
      }

      // Turn on continuous autofocus before frames start.
      await ensureAutoFocus(mediaStream)

      video.value.onloadedmetadata = updateAspectRatio
      // Orientation / track changes can alter the frame size.
      video.value.onresize = updateAspectRatio

      video.value.srcObject = mediaStream

      await video.value.play()

      updateAspectRatio()

      isCameraActive.value = true
    } catch (error) {
      stopCamera()

      cameraError.value =
        error instanceof Error
          ? error.message
          : 'Unable to access camera.'

      throw error
    }
  }

  function captureImage(): HTMLCanvasElement {
    if (!video.value?.videoWidth) {
      throw new Error('Camera is not ready.')
    }

    const canvas = document.createElement('canvas')

    canvas.width = video.value.videoWidth
    canvas.height = video.value.videoHeight

    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Canvas is not supported.')
    }

    context.drawImage(
      video.value,
      0,
      0,
      canvas.width,
      canvas.height
    )

    return canvas
  }

  function stopCamera(): void {
    stream.value?.getTracks().forEach(track => {
      track.stop()
    })

    stream.value = null
    isCameraActive.value = false

    if (video.value) {
      video.value.onloadedmetadata = null
      video.value.onresize = null
      video.value.srcObject = null
    }
  }

  onUnmounted(stopCamera)

  return {
    video,
    stream,
    cameraError,
    isCameraActive,
    videoAspectRatio,
    startCamera,
    captureImage,
    stopCamera
  }
}
