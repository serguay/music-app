<script setup>
defineProps({
  song: Object
})

defineEmits(['play'])
</script>

<template>
  <div class="song" @click="$emit('play', song)">
    <strong>{{ song.title }}</strong>
    <small>{{ song.artist }}</small>
  </div>
</template>

<style scoped>
.song {
  padding: 1rem;
  border-bottom: 1px solid #eee;
  cursor: pointer;
}
.song:hover {
  background: #f5f5f5;
}
small {
  display: block;
  opacity: 0.6;
}
</style>
