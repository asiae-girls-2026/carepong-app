export interface CatalogItem {
  item_type: 'DRUG' | 'HFF'
  product_id: number
  external_id?: string | null
  product_name: string
  manufacturer_name: string | null
  match_type?: 'EXACT' | 'CONTAINS' | 'FUZZY'
  score?: number
}
export interface CatalogSearchResult {
  items: CatalogItem[]
  error?: string
}
