import '@testing-library/jest-dom/vitest'

const createStorage = () => {
  let store = {}

  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = String(value)
    },
    removeItem: (key) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
}

const storage = createStorage()

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
})

Object.defineProperty(window, 'localStorage', {
  value: storage,
  configurable: true,
})
