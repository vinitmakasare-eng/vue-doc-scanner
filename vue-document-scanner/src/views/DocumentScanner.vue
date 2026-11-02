
<template>
  <main class="scanner-app">

    <!-- HEADER -->

    <header class="scanner-header">
      <button
        v-if="step !== 'camera' && step !== 'complete'"
        class="back-button"
        @click="goBack"
      >
        ← Back
      </button>

      <h2>Document Scanner</h2>

      <span class="step-indicator">
        {{ stepNumber }}/4
      </span>
    </header>

    <div class="progress">
      <div
        class="progress-fill"
        :style="{ width: `${stepNumber * 25}%` }"
      />
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <!-- CAMERA -->

    <section
      v-if="step === 'camera'"
      class="scanner-content"
    >
      <div class="camera-container">
        <video
          ref="video"
          autoplay
          playsinline
          muted
          :style="{
            aspectRatio: videoAspectRatio ?? undefined
          }"
        />

        <div class="camera-guide">
          Place your document inside the frame
        </div>
      </div>

      <div class="camera-controls">
        <button
          class="primary-button capture-button"
          :disabled="!isCameraActive || loading"
          @click="capture"
        >
          {{ loading ? 'Processing...' : 'Capture Document' }}
        </button>

        <button
          class="secondary-button"
          @click="startCamera"
        >
          Restart camera
        </button>
      </div>
    </section>

    <!-- CROP -->

    <section
      v-if="step === 'crop'"
      class="scanner-content"
    >
      <h3>Adjust document corners</h3>

      <CropEditor
        v-if="originalCanvas"
        :image-url="capturedImageUrl"
        :image-width="originalCanvas.width"
        :image-height="originalCanvas.height"
        :corners="corners"
        @update:corners="corners = $event"
        @reset="resetCorners"
      />

      <button
        class="primary-button full-button"
        :disabled="loading"
        @click="continueToFilters"
      >
        {{ loading ? 'Processing...' : 'Continue' }}
      </button>
    </section>

    <!-- FILTER -->

    <section
      v-if="step === 'filter'"
      class="scanner-content"
    >
      <h3>Select document filter</h3>

      <div class="document-preview">
        <img
          v-if="processedImageUrl"
          :src="processedImageUrl"
          alt="Filtered document"
        />

        <div v-if="loading" class="processing">
          Applying filter...
        </div>
      </div>

      <FilterSelector
        v-model="selectedFilter"
        :image-url="croppedImageUrl"
      />

      <button
        class="primary-button full-button"
        :disabled="loading"
        @click="continueToPreview"
      >
        Continue
      </button>
    </section>

    <!-- FINAL PREVIEW -->

    <section
      v-if="step === 'preview'"
      class="scanner-content"
    >
      <h3>Final document</h3>

      <FinalPreview
        v-if="processedImageUrl"
        :image-url="processedImageUrl"
        :uploading="uploading"
        @edit="step = 'crop'"
        @retake="retake"
        @upload="upload"
      />
    </section>

    <!-- SUCCESS -->

    <section
      v-if="step === 'complete'"
      class="success-screen"
    >
      <div class="success-icon">✓</div>

      <h2>Document uploaded successfully!</h2>

      <p>Your document has been uploaded.</p>

      <pre v-if="uploadResponse">{{
        JSON.stringify(uploadResponse, null, 2)
      }}</pre>

      <button
        class="primary-button full-button"
        @click="resetScanner"
      >
        Scan another document
      </button>
    </section>

  </main>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount
} from 'vue'

import type {
  Point,
  ScannerStep,
  DocumentFilter,
  UploadResponse
} from '@/types/scanner'

import CropEditor from '@/components/scanner/CropEditor.vue'
import FilterSelector from '@/components/scanner/FilterSelector.vue'
import FinalPreview from '@/components/scanner/FinalPreview.vue'

import { useCamera } from '@/composables/useCamera'

import { loadOpenCV } from '@/services/opencv.service'
import { detectDocument } from '@/services/documentDetection.service'
import { perspectiveCrop } from '@/services/perspectiveCrop.service'
import { applyFilter } from '@/services/imageProcessing.service'
import { uploadDocument } from '@/services/uploader.service'

const {
  video,
  isCameraActive,
  videoAspectRatio,
  startCamera: startCameraStream,
  captureImage,
  stopCamera
} = useCamera()

// Application state

const step = ref<ScannerStep>('camera')

const loading = ref(false)
const uploading = ref(false)
const error = ref('')

const originalCanvas = ref<HTMLCanvasElement | null>(null)
const croppedCanvas = ref<HTMLCanvasElement | null>(null)
const processedCanvas = ref<HTMLCanvasElement | null>(null)

const capturedImageUrl = ref('')
const croppedImageUrl = ref('')
const processedImageUrl = ref('')

const corners = ref<Point[]>([])

const selectedFilter = ref<DocumentFilter>('original')

const uploadResponse = ref<UploadResponse | null>(null)

let filterRequestId = 0

const stepNumber = computed(() => {
  const steps: Record<ScannerStep, number> = {
    camera: 1,
    crop: 2,
    filter: 3,
    preview: 4,
    complete: 4
  }

  return steps[step.value]
})

// Initialize

onMounted(async () => {
  try {
    loading.value = true

    await Promise.all([
      loadOpenCV(),
      startCameraStream()
    ])
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  stopCamera()
})

// Error helper

function getErrorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : 'Something went wrong.'
}

// Camera

async function startCamera(): Promise<void> {
  error.value = ''

  try {
    await startCameraStream()
  } catch (err) {
    error.value = getErrorMessage(err)
  }
}

async function capture(): Promise<void> {
  try {
    loading.value = true
    error.value = ''

    originalCanvas.value = captureImage()

    capturedImageUrl.value =
      originalCanvas.value.toDataURL('image/jpeg', 0.95)

    stopCamera()

    const detected = await detectDocument(
      originalCanvas.value
    )

    corners.value = detected ?? [
      { x: 0, y: 0 },
      { x: originalCanvas.value.width, y: 0 },
      {
        x: originalCanvas.value.width,
        y: originalCanvas.value.height
      },
      { x: 0, y: originalCanvas.value.height }
    ]

    step.value = 'crop'
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    loading.value = false
  }
}

// Crop

function resetCorners(): void {
  if (!originalCanvas.value) return

  corners.value = [
    { x: 0, y: 0 },
    { x: originalCanvas.value.width, y: 0 },
    {
      x: originalCanvas.value.width,
      y: originalCanvas.value.height
    },
    { x: 0, y: originalCanvas.value.height }
  ]
}

async function continueToFilters(): Promise<void> {
  try {
    if (!originalCanvas.value) {
      throw new Error('Original image is missing.')
    }

    loading.value = true
    error.value = ''

    croppedCanvas.value = await perspectiveCrop(
      originalCanvas.value,
      corners.value
    )

    croppedImageUrl.value =
      croppedCanvas.value.toDataURL('image/jpeg', 0.95)

    selectedFilter.value = 'original'

    await updateFilter()

    step.value = 'filter'
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    loading.value = false
  }
}

// Filters

async function updateFilter(): Promise<void> {
  if (!croppedCanvas.value) return

  const requestId = ++filterRequestId

  const result = await applyFilter(
    croppedCanvas.value,
    selectedFilter.value
  )

  if (requestId !== filterRequestId) return

  processedCanvas.value = result

  processedImageUrl.value =
    result.toDataURL('image/jpeg', 0.95)
}

watch(selectedFilter, async () => {
  if (
    step.value !== 'filter' ||
    !croppedCanvas.value
  ) {
    return
  }

  try {
    loading.value = true
    error.value = ''

    await updateFilter()
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    loading.value = false
  }
})

async function continueToPreview(): Promise<void> {
  if (!processedCanvas.value) {
    await updateFilter()
  }

  step.value = 'preview'
}

// Upload

async function upload(): Promise<void> {
  try {
    if (!processedCanvas.value) {
      throw new Error('Processed image is missing.')
    }

    uploading.value = true
    error.value = ''

    uploadResponse.value = await uploadDocument(
      processedCanvas.value
    )

    step.value = 'complete'
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    uploading.value = false
  }
}

// Navigation

async function goBack(): Promise<void> {
  error.value = ''

  if (step.value === 'crop') {
    step.value = 'camera'
    await startCamera()
  } else if (step.value === 'filter') {
    step.value = 'crop'
  } else if (step.value === 'preview') {
    step.value = 'filter'
  }
}

async function retake(): Promise<void> {
  clearImages()
  step.value = 'camera'

  await startCamera()
}

function clearImages(): void {
  // Invalidate pending filter processing.
  filterRequestId++

  originalCanvas.value = null
  croppedCanvas.value = null
  processedCanvas.value = null

  capturedImageUrl.value = ''
  croppedImageUrl.value = ''
  processedImageUrl.value = ''

  corners.value = []
}

async function resetScanner(): Promise<void> {
  clearImages()

  uploadResponse.value = null
  selectedFilter.value = 'original'

  step.value = 'camera'

  await startCamera()
}
</script>
