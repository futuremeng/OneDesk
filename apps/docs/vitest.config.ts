import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// resolve sibling source packages by path (not via node_modules), so a git
// worktree whose node_modules is linked to another checkout still tests
// against this checkout's edits (same convention as packages/pdf2docx)
const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@onedesk/docx-engine/lazy-media': local('../../packages/docx-engine/src/lazy-media.ts'),
      '@onedesk/docx-engine/zip-splice': local('../../packages/docx-engine/src/zip-splice.ts'),
      '@onedesk/docx-engine': local('../../packages/docx-engine/src/index.ts'),
      '@onedesk/font-metrics/resolve': local('../../packages/font-metrics/src/resolve.ts'),
      '@onedesk/font-metrics/word-faces.json': local('../../packages/font-metrics/word-faces.json'),
      '@onedesk/font-metrics': local('../../packages/font-metrics/src/index.ts'),
      // subpath before the bare name: string aliases are prefix replacements
      '@onedesk/electron-utils/headless-export': local(
        '../../packages/electron-utils/src/headless-export.ts',
      ),
      '@onedesk/electron-utils/atomic-write': local(
        '../../packages/electron-utils/src/atomic-write.ts',
      ),
      '@onedesk/electron-utils/safe-external-url': local(
        '../../packages/electron-utils/src/safe-external-url.ts',
      ),
      '@onedesk/electron-utils/program-files': local(
        '../../packages/electron-utils/src/program-files.ts',
      ),
      '@onedesk/electron-utils/print-cups': local(
        '../../packages/electron-utils/src/print-cups.ts',
      ),
      '@onedesk/electron-utils/print-job': local('../../packages/electron-utils/src/print-job.ts'),
      '@onedesk/electron-utils/generated-images': local(
        '../../packages/electron-utils/src/generated-images.ts',
      ),
      '@onedesk/electron-utils/remote-image': local(
        '../../packages/electron-utils/src/remote-image.ts',
      ),
      '@onedesk/electron-utils/safe-remote-url': local(
        '../../packages/electron-utils/src/safe-remote-url.ts',
      ),
      '@onedesk/electron-utils': local('../../packages/electron-utils/src/index.ts'),
      '@onedesk/ai-provider/codex-app-server': local(
        '../../packages/ai-provider/src/codex-app-server.ts',
      ),
      '@onedesk/ai-provider/trace': local('../../packages/ai-provider/src/trace.ts'),
      '@onedesk/ai-provider/custom-models': local(
        '../../packages/ai-provider/src/custom-models.ts',
      ),
      '@onedesk/ai-provider/browser': local('../../packages/ai-provider/src/browser.ts'),
      '@onedesk/ai-provider': local('../../packages/ai-provider/src/index.ts'),
      '@onedesk/i18n': local('../../packages/i18n/src/index.ts'),
      '@onedesk/ui/measurement': local('../../packages/ui/src/measurement.ts'),
      '@onedesk/ui': local('../../packages/ui/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // the engine's display-only `effective` keys stay out of saved-model toEqual
    setupFiles: [
      local('../../packages/docx-engine/tests/setup-equality.ts'),
      // every package a test saves must read back as strict XML
      local('../../packages/docx-engine/tests/setup-strict-xml.ts'),
      local('./tests/setup-dom.ts'),
    ],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
