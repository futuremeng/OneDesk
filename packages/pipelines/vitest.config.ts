import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@onedesk/pptx-engine/table-grid': resolve(here, '../pptx-engine/src/table-grid.ts'),
      '@onedesk/pptx-engine/identity': resolve(here, '../pptx-engine/src/identity.ts'),
      '@onedesk/pptx-engine/background-promote': resolve(
        here,
        '../pptx-engine/src/background-promote.ts',
      ),
      '@onedesk/pptx-engine/custgeom': resolve(here, '../pptx-engine/src/custgeom.ts'),
      '@onedesk/pptx-engine': resolve(here, '../pptx-engine/src/index.ts'),
      '@onedesk/pptx-render/preset-geometry': resolve(
        here,
        '../pptx-render/src/preset-geometry.ts',
      ),
      '@onedesk/pptx-render': resolve(here, '../pptx-render/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
