import { defineStore } from 'pinia'

export const useThemeStore = defineStore('theme', {
  state: () => ({
    dark: localStorage.getItem('theme') === 'dark'
  }),

  actions: {
    apply() {
      const root = document.documentElement
      const body = document.body
      root.classList.toggle('p-dark', this.dark)
      body.classList.toggle('p-dark', this.dark)
    },

    init() {
      this.apply()
    },

    toggle() {
      this.dark = !this.dark
      localStorage.setItem('theme', this.dark ? 'dark' : 'light')
      this.apply()
    }
  }
})