import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import {
  extractRepositorySpeechSpec,
  repositorySpeechSpecOptions,
} from '../codegen/repository-spec.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const virtualSpeechSpec = 'virtual:speech-spec'
const resolvedVirtualSpeechSpec = `\0${virtualSpeechSpec}`

function speechSpec(): Plugin {
  return {
    name: 'speech-spec',
    resolveId(source) {
      if (source === virtualSpeechSpec) return resolvedVirtualSpeechSpec
    },
    load(id) {
      if (id !== resolvedVirtualSpeechSpec) return
      const options = repositorySpeechSpecOptions(repositoryRoot)
      this.addWatchFile(path.resolve(repositoryRoot, options.tsconfig))
      this.addWatchFile(path.resolve(repositoryRoot, options.baseFile))
      this.addWatchFile(path.resolve(repositoryRoot, 'schemas/providers'))
      for (const provider of options.providers) this.addWatchFile(provider.file)
      return `export default ${JSON.stringify(extractRepositorySpeechSpec(repositoryRoot))}`
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    speechSpec(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
