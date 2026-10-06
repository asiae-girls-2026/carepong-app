import { ipcMain } from 'electron'
import type { CatalogItem, CatalogSearchResult } from '../core/catalog'

export type DrugSearchResult = CatalogSearchResult
// Public API endpoint only: no database credentials or public-data service keys in the app.
const DEFAULT_API_BASE_URL = 'http://carepong-alb-405431408.ap-northeast-2.elb.amazonaws.com'

export async function searchCatalog(query: string): Promise<CatalogSearchResult> {
  if (!query.trim()) return { items: [] }
  try {
    const base = process.env['CAREPONG_API_BASE_URL'] || DEFAULT_API_BASE_URL
    const url = new URL('/v1/catalog/search', base)
    url.searchParams.set('q', query.trim())
    url.searchParams.set('limit', '20')
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) {
      return { items: [], error: response.status === 401 || response.status === 403
        ? '검색 요청이 거부됐어요. 서버 인증·접근 설정을 확인해주세요.'
        : `검색 서버 오류 (${response.status}). 다시 시도해주세요.` }
    }
    const data: unknown = await response.json()
    const rows = (data as { items?: unknown })?.items
    if (!Array.isArray(rows) || !rows.every((row: CatalogItem) =>
      row && (row.item_type === 'DRUG' || row.item_type === 'HFF') &&
      Number.isInteger(row.product_id) && row.product_id > 0 && typeof row.product_name === 'string')) {
      return { items: [], error: '서버 검색 응답 형식을 확인해주세요.' }
    }
    return { items: rows }
  } catch {
    return { items: [], error: '검색 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.' }
  }
}

export function initDrugSearch(): void {
  ipcMain.handle('drug:search', (_event, query: unknown): Promise<CatalogSearchResult> =>
    typeof query === 'string' && query.length <= 200
      ? searchCatalog(query)
      : Promise.resolve({ items: [], error: '검색어는 200자 이내로 입력해주세요.' }))
}
