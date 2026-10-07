import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

export interface CollectorLine {
  window_start: string
  window_end?: string
  ts?: string
  window_sec: number
  features: Record<string, number> // 16피처
}

let child: ChildProcess | null = null
let paused = false

/**
 * collector.exe 위치
 *
 * 개발:
 *   app/resources/collector/collector.exe
 *
 * 패키징:
 *   process.resourcesPath/collector/collector.exe
 */
function exePath(): string {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        'collector',
        'collector.exe',
      )
    : path.join(
        app.getAppPath(),
        'resources',
        'collector',
        'collector.exe',
      )
}

/**
 * raw CSV 임시 저장 위치
 *
 * 실제 사용자 PC에서는 Electron userData 아래에 생성됨.
 * collector 중지 또는 앱 종료 시 삭제됨.
 */
function rawDirPath(): string {
  return path.join(
    app.getPath('userData'),
    'carepong_raw',
  )
}

/**
 * raw CSV 임시 폴더 삭제
 */
function cleanupRawDir(): void {
  const rawDir = rawDirPath()

  try {
    if (!fs.existsSync(rawDir)) {
      return
    }

    fs.rmSync(
      rawDir,
      {
        recursive: true,
        force: true,
      },
    )

    console.log(
      '[collector] raw 삭제:',
      rawDir,
    )
  } catch (error) {
    console.warn(
      '[collector] raw 삭제 실패:',
      error,
    )
  }
}

/**
 * collector.exe 시작
 */
export function startCollector(
  onWindow: (w: CollectorLine) => void,
  windowSec = 60,
): boolean {
  if (child) {
    return true
  }

  const exe = exePath()
  const rawDir = rawDirPath()

  if (!fs.existsSync(exe)) {
    console.warn(
      '[collector] exe 없음 - 감지 경로 비활성:',
      exe,
    )
    return false
  }

  fs.mkdirSync(
    rawDir,
    {
      recursive: true,
    },
  )

  child = spawn(
    exe,
    [
      '--window',
      String(windowSec),
      '--raw-dir',
      rawDir,
    ],
    {
      windowsHide: true,
      stdio: [
        'ignore',
        'pipe',
        'pipe',
      ],
    },
  )

  console.log(
    '[collector] 시작:',
    exe,
  )

  const rl = readline.createInterface({
    input: child.stdout!,
  })

  /**
   * collector stdout:
   * 1분마다 JSON 한 줄 수신
   */
  rl.on(
    'line',
    (line) => {
      let j: any

      try {
        j = JSON.parse(line)
      } catch {
        return
      }

      // started 메시지 등 features 없는 stdout은 무시
      if (!j || !j.features) {
        return
      }

      const normalized: CollectorLine = {
        window_start:
          j.window_start ??
          j.ts ??
          new Date().toISOString(),

        window_end:
          j.window_end,

        ts:
          j.ts,

        window_sec:
          typeof j.window_sec === 'number'
            ? j.window_sec
            : windowSec,

        features:
          j.features,
      }

      /**
       * 개발 확인용 로그
       *
       * 이 로그가 1분마다 나오면
       * collector.exe → Electron Main 전달 성공
       */
      console.log(
        '[collector] window received:',
        normalized,
      )

      onWindow(normalized)
    },
  )

  /**
   * collector 자체 로그
   */
  child.stderr?.on(
    'data',
    (data) => {
      const message = String(data).trim()

      if (message) {
        console.warn(
          '[collector]',
          message,
        )
      }
    },
  )

  child.on(
    'error',
    (error) => {
      console.error(
        '[collector] 실행 오류:',
        error,
      )
    },
  )

  child.on(
    'exit',
    (code) => {
      console.warn(
        '[collector] 종료 code=',
        code,
      )

      child = null

      /**
       * collector가 파일 사용을 끝낸 뒤
       * raw CSV 삭제
       */
      cleanupRawDir()
    },
  )

  return true
}

/**
 * collector 중지
 *
 * 실제 raw 삭제는 child exit 이벤트에서 수행하여
 * collector가 CSV를 쓰는 도중 삭제되는 상황을 피함.
 */
export function stopCollector(): void {
  if (!child) {
    cleanupRawDir()
    return
  }

  console.log(
    '[collector] 정지 요청',
  )

  child.kill()
}

/**
 * collector 실행 여부
 */
export const collectorRunning = (): boolean =>
  child !== null

/**
 * 사용자 수동 pause
 */
export function setCollectorPaused(
  on: boolean,
): void {
  paused = on
}

/**
 * 현재 시간이 quiet hours인지 확인
 *
 * 예:
 * 18:30 ~ 08:30
 *
 * 자정을 넘는 시간 범위도 처리함.
 */
export function inQuietHours(
  now: Date,
  start = '18:30',
  end = '08:30',
): boolean {
  const toMin = (
    value: string,
  ): number => {
    const [h, m] = value
      .split(':')
      .map(Number)

    return h * 60 + (m || 0)
  }

  const current =
    now.getHours() * 60 +
    now.getMinutes()

  const startMin = toMin(start)
  const endMin = toMin(end)

  return startMin <= endMin
    ? current >= startMin &&
        current < endMin
    : current >= startMin ||
        current < endMin
}

/**
 * 설정을 1분마다 확인하여
 * collector를 자동 시작/중지
 *
 * 기본:
 * 08:30 ~ 18:30 수집
 * 18:30 ~ 08:30 수집 중지
 */
export function scheduleCollector(
  getConfig: () => {
    quietEnabled?: boolean
    quietHours?: {
      start: string
      end: string
    }
  },
  onWindow: (
    w: CollectorLine,
  ) => void,
): void {
  const tick = (): void => {
    const config = getConfig()

    const quiet =
      (config.quietEnabled ?? true) &&
      inQuietHours(
        new Date(),
        config.quietHours?.start ??
          '18:30',
        config.quietHours?.end ??
          '08:30',
      )

    const shouldRun =
      !quiet &&
      !paused

    console.log(
      '[collector] schedule check:',
      {
        quiet,
        paused,
        shouldRun,
      },
    )

    if (
      shouldRun &&
      !collectorRunning()
    ) {
      startCollector(
        onWindow,
      )
    }

    if (
      !shouldRun &&
      collectorRunning()
    ) {
      stopCollector()
    }
  }

  tick()

  setInterval(
    tick,
    60 * 1000,
  )

  /**
   * 앱 종료 시:
   * collector 종료 → raw 삭제
   */
  app.on(
    'before-quit',
    stopCollector,
  )
}