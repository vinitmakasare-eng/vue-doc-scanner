
<template>
  <div class="crop-editor">
    <div
      ref="container"
      class="crop-stage"
      :style="{ '--crop-pad': `${HANDLE_PAD}px` }"
    >
      <img
        :src="imageUrl"
        class="crop-image"
        draggable="false"
        alt="Document to crop"
      />

      <svg
        class="crop-overlay"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        @pointermove="moveCorner"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <polygon
          :points="polygonPoints"
          fill="rgba(20,180,110,0.12)"
          stroke="#21d68b"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />

        <g
          v-for="(point, index) in normalizedPoints"
          :key="index"
        >
          <!-- Invisible, larger target so the corner is easy to grab by touch -->
          <ellipse
            :cx="point.x"
            :cy="point.y"
            :rx="touchRadii.rx"
            :ry="touchRadii.ry"
            fill="transparent"
            pointer-events="all"
            class="crop-handle-touch"
            @pointerdown.stop="startDrag(index, $event)"
          />

          <ellipse
            :cx="point.x"
            :cy="point.y"
            :rx="handleRadii.rx"
            :ry="handleRadii.ry"
            fill="#fff"
            stroke="#13b981"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
            pointer-events="none"
            class="crop-handle"
          />
        </g>
      </svg>
    </div>

    <p class="crop-instructions">
      Drag the corners to adjust the document boundary.
    </p>

    <button
      class="secondary-button"
      @click="$emit('reset')"
    >
      Reset crop
    </button>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref
} from 'vue'
import type { Point } from '@/types/scanner'

const props = defineProps<{
  imageUrl: string
  imageWidth: number
  imageHeight: number
  corners: Point[]
}>()

const emit = defineEmits<{
  'update:corners': [corners: Point[]]
  reset: []
}>()

// Handle sizes in CSS pixels. They are converted to viewBox units
// below so the grab targets stay finger-sized even when a very tall
// image is scaled down to fit on screen.
const HANDLE_RADIUS_PX = 12
const HANDLE_TOUCH_RADIUS_PX = 26

// Empty space around the image so handles sitting on the image edges
// (e.g. when no document was detected) stay fully visible and grabbable.
const HANDLE_PAD = 30

const container = ref<HTMLDivElement | null>(null)

const activeIndex = ref<number | null>(null)

const displaySize = ref({ width: 0, height: 0 })

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const element = container.value

  if (!element || typeof ResizeObserver === 'undefined') {
    return
  }

  resizeObserver = new ResizeObserver(() => {
    const rect = element.getBoundingClientRect()

    displaySize.value = {
      width: rect.width,
      height: rect.height
    }
  })

  resizeObserver.observe(element)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

// The overlay's viewBox is stretched non-uniformly (0-1000 in both
// axes), so radii need separate x/y values to stay circular on screen.
function toRadii(pixels: number): { rx: number; ry: number } {
  const { width, height } = displaySize.value

  if (!width || !height) {
    return { rx: HANDLE_RADIUS_PX, ry: HANDLE_RADIUS_PX }
  }

  return {
    rx: (pixels / width) * 1000,
    ry: (pixels / height) * 1000
  }
}

const handleRadii = computed(() =>
  toRadii(HANDLE_RADIUS_PX)
)

const touchRadii = computed(() =>
  toRadii(HANDLE_TOUCH_RADIUS_PX)
)

// Distance between the grab point and the corner, in image coordinates, so a
// large touch target doesn't make the corner jump under the finger.
let dragOffset = { x: 0, y: 0 }

// The overlay's viewBox spans the padded stage, not just the image,
// so image coordinates are offset by the padding before scaling.
function toOverlayPoint(point: Point): { x: number; y: number } {
  const { width, height } = displaySize.value

  const padX = width ? (HANDLE_PAD / width) * 1000 : 0
  const padY = height ? (HANDLE_PAD / height) * 1000 : 0

  return {
    x: padX + (point.x / props.imageWidth) * (1000 - padX * 2),
    y: padY + (point.y / props.imageHeight) * (1000 - padY * 2)
  }
}

const normalizedPoints = computed(() =>
  props.corners.map(toOverlayPoint)
)

const polygonPoints = computed(() =>
  normalizedPoints.value
    .map(point => `${point.x},${point.y}`)
    .join(' ')
)

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toImagePoint(event: PointerEvent): Point | null {
  if (!container.value) {
    return null
  }

  const rect = container.value.getBoundingClientRect()

  const imageWidthPx = rect.width - HANDLE_PAD * 2
  const imageHeightPx = rect.height - HANDLE_PAD * 2

  if (imageWidthPx <= 0 || imageHeightPx <= 0) {
    return null
  }

  return {
    x: clamp(
      ((event.clientX - rect.left - HANDLE_PAD) /
        imageWidthPx) *
        props.imageWidth,
      0,
      props.imageWidth
    ),
    y: clamp(
      ((event.clientY - rect.top - HANDLE_PAD) /
        imageHeightPx) *
        props.imageHeight,
      0,
      props.imageHeight
    )
  }
}

function startDrag(
  index: number,
  event: PointerEvent
): void {
  activeIndex.value = index

  const pointer = toImagePoint(event)
  const corner = props.corners[index]

  dragOffset = pointer
    ? { x: corner.x - pointer.x, y: corner.y - pointer.y }
    : { x: 0, y: 0 }

  const target = event.currentTarget as SVGElement

  target.setPointerCapture(event.pointerId)
}

function moveCorner(event: PointerEvent): void {
  if (activeIndex.value === null) {
    return
  }

  const pointer = toImagePoint(event)

  if (!pointer) {
    return
  }

  const x = clamp(
    pointer.x + dragOffset.x,
    0,
    props.imageWidth
  )

  const y = clamp(
    pointer.y + dragOffset.y,
    0,
    props.imageHeight
  )

  const updated = props.corners.map(point => ({
    ...point
  }))

  updated[activeIndex.value] = { x, y }

  emit('update:corners', updated)
}

function endDrag(): void {
  activeIndex.value = null
}
</script>

<style scoped>
.crop-editor {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

/*
 * The stage shrink-wraps the image and adds padding around it. The
 * image is capped to the space left by the header, title and buttons
 * so even very tall captures fit on screen without scrolling, while
 * the padding keeps handles on the image edges fully grabbable.
 */
.crop-stage {
  position: relative;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  padding: var(--crop-pad, 30px);
}

.crop-image {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 60vh;
  max-height: clamp(
    120px,
    calc(
      100dvh - 380px - var(--crop-pad, 30px) -
        var(--crop-pad, 30px)
    ),
    60vh
  );
  object-fit: contain;
  background: #111;
  border-radius: 6px;
  user-select: none;
}

.crop-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  touch-action: none;
}

.crop-handle {
  pointer-events: none;
}

.crop-handle-touch {
  cursor: grab;
  touch-action: none;
}

.crop-instructions {
  color: #aaa;
  text-align: center;
  font-size: 13px;
  padding: 8px 0;
}
</style>
