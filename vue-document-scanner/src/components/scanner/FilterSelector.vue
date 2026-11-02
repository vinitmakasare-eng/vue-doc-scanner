
<template>
  <div class="filter-selector">
    <button
      v-for="filter in filters"
      :key="filter.id"
      class="filter-item"
      :class="{
        active: modelValue === filter.id
      }"
      @click="$emit('update:modelValue', filter.id)"
    >
      <div
        class="filter-preview"
        :style="{ filter: filter.css }"
      >
        <img
          :src="imageUrl"
          alt=""
        />
      </div>

      <span class="filter-name">
        {{ filter.name }}
      </span>

      <span class="filter-description">
        {{ filter.description }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type {
  DocumentFilter,
  FilterOption
} from '@/types/scanner'

defineProps<{
  modelValue: DocumentFilter
  imageUrl: string
}>()

defineEmits<{
  'update:modelValue': [value: DocumentFilter]
}>()

const filters: FilterOption[] = [
  {
    id: 'original',
    name: 'Original',
    description: 'No enhancement',
    css: 'none'
  },
  {
    id: 'enhance',
    name: 'Enhance',
    description: 'Whiten paper, deepen text',
    css: 'grayscale(1) contrast(1.35) brightness(1.12)'
  },
  {
    id: 'color',
    name: 'Colour',
    description: 'Colour + even light',
    css: 'contrast(1.15) saturate(1.15) brightness(1.08)'
  },
  {
    id: 'white',
    name: 'Paper White',
    description: 'Brightest white page',
    css: 'grayscale(1) contrast(1.6) brightness(1.2)'
  },
  {
    id: 'contrast',
    name: 'High Contrast',
    description: 'Strong local contrast',
    css: 'grayscale(1) contrast(1.75)'
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    description: 'Natural grey',
    css: 'grayscale(1)'
  },
  {
    id: 'bw',
    name: 'B&W Clean',
    description: 'Crisp binary text',
    css: 'grayscale(1) contrast(2.2) brightness(1.1)'
  },
  {
    id: 'clean',
    name: 'Clean Scan',
    description: 'Denoised B&W',
    css: 'grayscale(1) contrast(2.4)'
  },
  {
    id: 'faded',
    name: 'Faded Text',
    description: 'Rescue faint strokes',
    css: 'grayscale(1) contrast(1.5) brightness(1.08)'
  },
  {
    id: 'sharp',
    name: 'Sharp Text',
    description: 'Crisper edges',
    css: 'grayscale(1) contrast(1.45)'
  },
  {
    id: 'invert',
    name: 'Invert',
    description: 'White on black',
    css: 'grayscale(1) invert(1) contrast(1.3)'
  }
]
</script>

<style scoped>
.filter-selector {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 12px 2px 16px;
  scrollbar-width: thin;
}

.filter-item {
  flex: 0 0 100px;
  min-width: 100px;
  border: 1px solid transparent;
  background: #25262b;
  color: white;
  padding: 8px;
  border-radius: 10px;
  cursor: pointer;
  text-align: center;
}

.filter-item.active {
  border-color: #21d68b;
  background: #18382c;
}

.filter-preview {
  width: 82px;
  height: 100px;
  margin: auto;
  overflow: hidden;
  background: white;
  border-radius: 6px;
}

.filter-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.filter-name {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-top: 9px;
  white-space: nowrap;
}

.filter-description {
  display: block;
  font-size: 10px;
  color: #aaa;
  margin-top: 5px;
  line-height: 1.3;
}
</style>
