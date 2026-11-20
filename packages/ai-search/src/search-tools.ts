/**
 * ai:web-search / ai:image-search for the editors' main processes: reads
 * ai-settings.json live and turns the search provider choice into
 * SearchOptions — OneDesk keeps the historic chain (onedesk when signed in and
 * cloud tools are on, then env keys, then free Parallel MCP, then DuckDuckGo); a
 * selected custom provider runs first and skips onedesk. Keenable's free endpoint
 * only runs when Keenable is the selected provider.
 */

import {
  activeSearchProvider,
  cloudToolsEnabled,
  type AiSearchProviderId,
  type AiSettings,
} from '@onedesk/ai-provider'
import { imageSearch, webSearch, type SearchOptions } from './index'
import { readAiSettingsFile } from './media-tools'

export function searchOptionsFromSettings(settings: AiSettings): SearchOptions {
  const provider = activeSearchProvider(settings)
  if (provider === 'onedesk') return { useOneDesk: cloudToolsEnabled(settings) }
  const key = settings.search!.providers?.[provider]?.apiKey?.trim() ?? ''
  if (provider === 'parallel') return { useOneDesk: false, parallelKey: key, prefer: 'parallel' }
  if (provider === 'serply') return { useOneDesk: false, serplyKey: key, prefer: 'serply' }
  if (provider === 'searchapi') return { useOneDesk: false, searchapiKey: key, prefer: 'searchapi' }
  if (provider === 'exa') return { useOneDesk: false, exaKey: key, prefer: 'exa' }
  if (provider === 'firecrawl') return { useOneDesk: false, firecrawlKey: key, prefer: 'firecrawl' }
  if (provider === 'keenable') return { useOneDesk: false, keenableKey: key, prefer: 'keenable' }
  return provider === 'tavily'
    ? { useOneDesk: false, tavilyKey: key, prefer: 'tavily' }
    : { useOneDesk: false, serperKey: key }
}

export function webSearchTool(settingsPath: string, query: string, maxResults = 6) {
  return webSearch(query, maxResults, searchOptionsFromSettings(readAiSettingsFile(settingsPath)))
}

export function imageSearchTool(settingsPath: string, query: string, maxResults = 8) {
  return imageSearch(query, maxResults, searchOptionsFromSettings(readAiSettingsFile(settingsPath)))
}

/** settings-UI test: the selected backend (keyed or free) must answer one minimal query. */
export async function testSearchProvider(
  provider: AiSearchProviderId,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  if (provider === 'onedesk') return { ok: true }
  apiKey = apiKey.trim()
  if (!apiKey && provider !== 'parallel' && provider !== 'keenable')
    return { ok: false, error: 'API key is empty' }
  const options: SearchOptions = {
    useOneDesk: false,
    serperKey: provider === 'serper' ? apiKey : '',
    serplyKey: provider === 'serply' ? apiKey : '',
    searchapiKey: provider === 'searchapi' ? apiKey : '',
    tavilyKey: provider === 'tavily' ? apiKey : '',
    parallelKey: provider === 'parallel' ? apiKey : '',
    exaKey: provider === 'exa' ? apiKey : '',
    firecrawlKey: provider === 'firecrawl' ? apiKey : '',
    keenableKey: provider === 'keenable' ? apiKey : '',
    prefer: provider,
  }
  const r = await webSearch('OneDesk', 1, options)
  if (r.method === provider) return { ok: true }
  return {
    ok: false,
    error:
      r.method === 'error'
        ? (r.error ?? 'search failed')
        : `${provider} did not answer (service unavailable, key rejected or quota exhausted); fell back to ${r.method}`,
  }
}
