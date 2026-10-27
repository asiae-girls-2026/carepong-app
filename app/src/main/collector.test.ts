// 잔존 collector.exe 프로세스(orphan) 판별 — PowerShell(Get-CimInstance Win32_Process) 출력 파싱 (민서 10/27)
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => 'X:\\ud', getAppPath: () => 'X:\\app' } }))
vi.mock('./api', () => ({ uploadRawBatch: async () => true }))

import { listOrphanCollectorPids } from './collector'

const EXE = 'C:\\Users\\u\\AppData\\Local\\Programs\\care-pong\\resources\\collector\\collector.exe'
// 10/27 실측과 같은 구성: 잔존 프로세스 4건(상위 프로세스 종료됨) + 현재 정상 쌍(런처 2852 ← CarePong 14428, 워커 33848 ← 2852)
const OUT = [
  `14992\t4680\t${EXE}`,
  `35188\t5132\t${EXE}`,
  `14632\t20708\t${EXE}`,
  `35364\t35376\t${EXE}`,
  `2852\t14428\t${EXE}`,
  `33848\t2852\t${EXE}`,
  `777\t1\tC:\\Other\\collector.exe`, // 다른 프로그램의 동명 exe — 종료 대상 아님
  '', // 빈 줄
].join('\r\n')

const onWin = process.platform === 'win32' ? it : it.skip

describe('listOrphanCollectorPids', () => {
  onWin('현재 런처와 그 워커는 제외하고, 동일 exe 경로의 잔존 프로세스만 반환한다', () => {
    expect(listOrphanCollectorPids(EXE, 2852, OUT).sort()).toEqual([14632, 14992, 35188, 35364].sort())
  })
  onWin('현재 인스턴스가 없을 때(앱 시작 직후)는 동일 경로 전부가 잔존 프로세스', () => {
    expect(listOrphanCollectorPids(EXE, null, OUT).length).toBe(6)
  })
  onWin('경로 대소문자·슬래시 차이는 동일 exe 로 취급한다', () => {
    const alt = EXE.toUpperCase().replace(/\\/g, '/')
    expect(listOrphanCollectorPids(alt, 2852, OUT).length).toBe(4)
  })
  onWin('다른 경로의 collector.exe 는 포함하지 않는다', () => {
    expect(listOrphanCollectorPids(EXE, null, OUT)).not.toContain(777)
  })
  onWin('조회 결과가 비어 있으면 빈 배열', () => {
    expect(listOrphanCollectorPids(EXE, null, '')).toEqual([])
  })
})
