/** Select registered products, then explicitly confirm once. Intermediate replies stay internal. */
export interface DdiReply {
  conversation_id: string | null
  status: string
  message: string
  selected_products?: unknown[]
  selected_registered_ids?: (number | string)[]
  selected_count?: number
  can_confirm?: boolean
}
export type DdiResult = { ok: true; data: DdiReply } | { ok: false; status: number | null; message: string }
export interface DdiApi {
  medChatSelect: (conversationId: string, productId?: number | string, registeredId?: number) => Promise<DdiResult>
  medChatConfirm: (conversationId: string) => Promise<DdiResult>
}
export function registeredIds(reply: DdiReply): number[] {
  const ids = reply.selected_registered_ids ?? (reply.selected_products ?? []).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const id = (value as { user_medication_id?: unknown }).user_medication_id
    return typeof id === 'number' || typeof id === 'string' ? [id] : []
  })
  return [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
}
export function selectedCount(reply: DdiReply): number {
  if (Array.isArray(reply.selected_products)) return reply.selected_products.length
  return typeof reply.selected_count === 'number' ? reply.selected_count : registeredIds(reply).length
}
export async function submitRegisteredDdi(
  api: DdiApi, conversationId: string, pickedIds: number[], initial: DdiReply,
  onSelection: (reply: DdiReply) => void,
): Promise<DdiReply> {
  let latest = initial
  const wanted = [...new Set(pickedIds)]
  if (wanted.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('등록약 ID가 올바르지 않아요.')
  const checked = (result: DdiResult): DdiReply => {
    if (!result.ok) throw new Error(result.message || '서버 요청에 실패했어요.')
    const reply = result.data
    if (reply.conversation_id !== conversationId) throw new Error('대화 정보가 달라졌어요. 현재 검사를 취소하고 다시 시작해 주세요.')
    if (reply.status === 'ERROR' || reply.status === 'CONVERSATION_EXPIRED') throw new Error(reply.message)
    return reply
  }
  for (const id of wanted) {
    if (registeredIds(latest).includes(id)) continue
    latest = checked(await api.medChatSelect(conversationId, undefined, id))
    // Retain each acknowledged selection so a retry does not submit it twice.
    onSelection(latest)
  }
  if (!latest.can_confirm || selectedCount(latest) < 2 || selectedCount(latest) > 5) {
    throw new Error('검사 대상은 앞서 고른 제품을 포함해 총 2~5개여야 해요. 선택 상태를 확인해 주세요.')
  }
  const final = checked(await api.medChatConfirm(conversationId))
  if (final.status !== 'COMPLETED') throw new Error(final.message || '검사가 완료되지 않았어요.')
  return final
}
