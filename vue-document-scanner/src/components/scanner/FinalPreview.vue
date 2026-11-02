
<template>
  <div class="final-preview">
    <img
      :src="imageUrl"
      alt="Final scanned document"
    />

    <div class="preview-actions">
      <button
        class="secondary-button"
        @click="$emit('edit')"
      >
        Edit
      </button>

      <button
        class="secondary-button"
        @click="$emit('retake')"
      >
        Retake
      </button>

      <button
        class="primary-button"
        :disabled="uploading"
        @click="$emit('upload')"
      >
        {{ uploading ? 'Uploading...' : 'Upload document' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  imageUrl: string
  uploading: boolean
}>()

defineEmits<{
  edit: []
  retake: []
  upload: []
}>()
</script>

<style scoped>
.final-preview img {
  display: block;
  width: 100%;
  max-height: 65vh;
  object-fit: contain;
  background: #222;
  border-radius: 10px;
}

.preview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}
</style>
