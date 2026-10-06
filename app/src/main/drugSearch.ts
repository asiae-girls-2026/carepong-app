// 식약처 'e약은요' 의약품개요정보 검색 — 키가 없거나 실패하면 목업으로 폴백
import { ipcMain } from 'electron'
import { searchMock, templateBboong, type DrugInfo } from '../core/drugData'

const API_URL = 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList'

export interface DrugSearchResult {
  source: 'api' | 'mock'
  items: DrugInfo[]
}

interface ApiRow {
  itemName?: string
  entpName?: string
  efcyQesitm?: string
  useMethodQesitm?: string
  atpnQesitm?: string
}

const strip = (s?: string): string => (s ?? '').replace(/<[^>]+>/g, '').trim()

async function searchApi(name: string, key: string): Promise<DrugInfo[] | null> {
  const url = `${API_URL}?serviceKey=${encodeURIComponent(key)}&itemName=${encodeURIComponent(name)}&type=json&numOfRows=3`
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) return null
  const data = (await res.json()) as { body?: { items?: ApiRow[] } }
  const rows = data?.body?.items ?? []
  if (rows.length === 0) return null
  return rows.map((r) => {
    const efficacy = strip(r.efcyQesitm) || '정보 없음'
    return {
      name: r.itemName ?? name,
      company: r.entpName ?? '',
      efficacy,
      usage: strip(r.useMethodQesitm) || '정보 없음',
      caution: strip(r.atpnQesitm) || '정보 없음',
      bboong: templateBboong(r.itemName ?? name, efficacy),
    }
  })
}

export function initDrugSearch(): void {
  ipcMain.handle('drug:search', async (_e, name: string): Promise<DrugSearchResult> => {
    const query = (name ?? '').trim()
    if (!query) return { source: 'mock', items: [] }
    const key = process.env['DATA_GO_KR_KEY']
    if (key) {
      try {
        const items = await searchApi(query, key)
        if (items) return { source: 'api', items }
      } catch {
        // 폴백으로 진행
      }
    }
    return { source: 'mock', items: searchMock(query) }
  })
}
