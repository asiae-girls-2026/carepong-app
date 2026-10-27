// 고아 collector.exe 판별 — PowerShell(Get-CimInstance Win32_Process) 출력 파싱 (민서 10/27)
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => 'X:\\ud', getAppPath: () => 'X:\\app' } }))
vi.mock('./api', () => ({ uploadRawBatch: async () => true }))

import { listOrphanCollectorPids } from './collector'

const EXE = 'C:\\Users\\u\\AppData\\Local\\Programs\\care-pong\\resources\\collector\\collector.exe'
// 10/27 민서 PC 실측과 같은 모양: 좀비 4(부모 사망) + 오늘 정상 쌍(부트로더 2852 ← CarePong 14428, 파이썬 33848 ← 2852)
const OUT = [
  `14992\t4680\t${EXE}`,
  `35188\t5132\t${EXE}`,
  `14632\t20708\t${EXE}`,
  `35364\t35376\t${EXE}`,
  `2852\t14428\t${EXE}`,
  `33848\t2852\t${EXE}`,
  `777\t1\tC:\\Other\\collector.exe`, // 다른 프로그램의 collector.exe — 건드리면 안 됨
  '', // 빈 줄
].join('\r\n')

const onWin = process.platform === 'win32' ? it : it.skip

describe('listOrphanCollectorPids', () => {
  onWin('내 자식(부트로더)과 그 파이썬 자식은 제외하고, 같은 exe 경로의 고아만 고른다', () => {
    expect(listOrphanCollectorPids(EXE, 2852, OUT).sort()).toEqual([14632, 14992, 35188, 35364].sort())
  })
  onWin('자식이 없을 때(앱 시작 직후)는 같은 경로 전부가 고아', () => {
    expect(listOrphanCollectorPids(EXE, null, OUT).length).toBe(6)
  })
  onWin('경로 대소문자·슬래시 차이는 같은 exe 로 본다', () => {
    const alt = EXE.toUpperCase().replace(/\\/g, '/')
    expect(listOrphanCollectorPids(alt, 2852, OUT).length).toBe(4)
  })
  onWin('다른 경로의 collector.exe 는 절대 포함하지 않는다', () => {
    expect(listOrphanCollectorPids(EXE, null, OUT)).not.toContain(777)
  })
  onWin('조회 결과가 비면 빈 배열', () => {
    expect(listOrphanCollectorPids(EXE, null, '')).toEqual([])
  })
})
