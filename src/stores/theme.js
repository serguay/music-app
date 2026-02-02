import { defineStore } from 'pinia'

export const useThemeStore = defineStore('theme', {
  state: () => ({
    dark: localStorage.getItem('theme') === 'dark'
  }),

  actions: {
    init() {
      document.documentElement.classList.toggle('p-dark', this.dark)
      document.body.classList.toggle('p-dark', this.dark)
    },

    toggle() {
      this.dark = !this.dark
      localStorage.setItem('theme', this.dark ? 'dark' : 'light')
      document.documentElement.classList.toggle('p-dark', this.dark)
      document.body.classList.toggle('p-dark', this.dark)
    }
  }
})
