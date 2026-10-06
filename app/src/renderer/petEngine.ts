// 게이지 자연 감소 — 하루 3회 고정 드롭(11·14·17시). 활성 시간(앱이 켜져 있는 동안)만.
// 죽음·상태 판정 없음.

// (last, now] 구간에 들어온 감소 시각(DECAY_HOURS)의 개수. 보통 틱(1분)마다 0 또는 1.
// 앱이 꺼져 있던 동안은 last=now 로 리셋되므로 그 시간대 드롭은 적용되지 않는다(기획서: 앱 꺼진 시간 감소 없음).
export function decayDropsBetween(last: number, now: number, hours: readonly number[]): number {
  if (now <= last) return 0
  let count = 0
  const start = new Date(last)
  start.setHours(0, 0, 0, 0)
  for (let d = start.getTime(); d <= now; d += 86_400_000) {
    const day = new Date(d)
    for (const h of hours) {
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0, 0).getTime()
      if (t > last && t <= now) count++
    }
  }
  return count
}
