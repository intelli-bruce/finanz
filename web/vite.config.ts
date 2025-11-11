import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const reactDir = path.dirname(require.resolve('react/package.json'))
const reactDomDir = path.dirname(require.resolve('react-dom/package.json'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // npm workspaces hoist React deps to the repo root, so point Vite at the resolved files explicitly.
      '@': path.resolve(__dirname, './src'),
      react: reactDir,
      'react/jsx-runtime': path.join(reactDir, 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(reactDir, 'jsx-dev-runtime.js'),
      'react-dom': reactDomDir,
      'react-dom/client': path.join(reactDomDir, 'client.js'),
      'react-dom/server': path.join(reactDomDir, 'server.node.js'),
      'react-dom/test-utils': path.join(reactDomDir, 'test-utils.js'),
    },
  },
})
