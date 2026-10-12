import { app, BrowserWindow, ipcMain, screen, Menu, Notification, Tray, nativeImage, dialog } from 'electron'
import { join } from 'path'
import {
  loadState,
  saveState,
  loadHealth,
  saveHealth,
  loadIntake,
  saveIntake,
  type PersistedState,
} from './store'
import type { HealthConfig } from '../core/health'
import type { IntakeLog } from '../core/intake'
import { initStressManager } from './stress'
import { initDrugSearch } from './drugSearch'
import * as api from './api'

// 펫 상태 백업 매핑 (호출위치표 E: putPet) — 누적 하트로 가구 단계 산출(기획서 방꾸미기 언락 임계)
const FURNITURE_THRESHOLDS = [10, 30, 60, 100, 150, 210, 280, 340, 400]
const furnitureStage = (hearts: number): number =>
  FURNITURE_THRESHOLDS.filter((t) => hearts >= t).length
// 서버 PUT /v1/pet 는 character_slot 을 1·2·3 숫자만 받음 (문자열 "cat" → 422).
const CHARACTER_SLOTS: Record<string, number> = { cat: 1, dragon: 2, quokka: 2, dog: 3 }
const characterSlot = (creature: string): number => CHARACTER_SLOTS[creature] ?? 1
function petBackup(state: PersistedState): Record<string, unknown> {
  const p = state.pet
  const hearts = p.lifetime?.chats ?? 0 // 하트 = 누적 대화(chat_message) — 서버도 chat_message 로 교차검증
  return {
    name: p.name,
    character_slot: characterSlot(p.creature),
    generation: p.generation,
    level: p.stage,
    xp: p.xp,
    happiness: p.stats.happiness,
    health: p.stats.health,
    energy: p.stats.energy,
    hearts_total: hearts,
    furniture_stage: furnitureStage(hearts),
    updated_at: new Date().toISOString(),
  }
}
function routinesBackup(c: HealthConfig): Record<string, unknown> {
  return {
    water_goal_cups: c.water?.dailyTargetCups,
    water_interval_min: c.water?.intervalMinutes,
    stretch_interval_min: c.aux?.stretchMin,
    rest_interval_min: c.aux?.restMin,
    dnd_schedule_enabled: c.quietEnabled ?? true,
    dnd_start: c.quietHours?.start,
    dnd_end: c.quietHours?.end,
    pet_motion_minimal: c.minimalMotion ?? false,
  }
}

// 윈도우: 알림 표시에 AppUserModelID 필요
if (process.platform === 'win32') {
  app.setAppUserModelId('com.chaewon.carepong')
}

let win: BrowserWindow | null = null
let chat: BrowserWindow | null = null
let tray: Tray | null = null

// 트레이 아이콘 — 맥: 메뉴바 템플릿(단색) / 윈도우: 컬러(코랄 하트)
const TRAY_ICON_MAC =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAASElEQVR4Ac3BQQrAIBAEwZ4l///y5CLoohFhD6aK60RmOpGZTjRB0cM3c0DMzJ4YiMycEU1QFBQFRUFRUCRmZk8MxJpZE7/zAsyyBxUvvfsTAAAAAElFTkSuQmCC'
const TRAY_ICON_WIN =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAkklEQVR4nGNgoBAw4pJ4UBD/H5mvMGEhVrUYgjCN8lLSKOIPnz3FahAK50FB/H90jejg4bOnKIYwkaIZ5jJk7zHhU0wMYMJpe2krBKOz0VyB3QVIinGykV2AAbqrsbsXizjuMEBXjMNQJgYGSNzC4hmrJjTNyFFJOBZweQfZBXhdgQbQExJ1kzI2g5BdSNB55AAASSdHGHG34DQAAAAASUVORK5CYII='

function createTray(): void {
  if (tray) return
  const isMac = process.platform === 'darwin'
  const img = nativeImage.createFromDataURL(
    'data:image/png;base64,' + (isMac ? TRAY_ICON_MAC : TRAY_ICON_WIN),
  )
  if (isMac) img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('케어퐁 — 스트레스 케어 데스크탑 펫')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '미니홈 🏠', click: () => openChatWindow('heart') },
      { label: '설정 ⚙️', click: () => openChatWindow('settings') },
      { label: '방해금지 전환 🔕', click: () => win?.webContents.send('pet:menuCommand', 'dnd') },
      { label: '펫 표시/숨김', click: () => win?.webContents.send('pet:menuCommand', 'hide') },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ]),
  )
}

// 미니홈(chat) 표시 여부를 오버레이 펫 창에 알린다 — 미니홈이 보일 땐 게이지 팝업 숨김(겹침 방지)
function notifyChatVisible(visible: boolean): void {
  if (win && !win.isDestroyed()) win.webContents.send('chat:visible', visible)
}
function openChatWindow(mode: 'med' | 'heart' | 'settings' = 'heart'): void {
  if (chat && !chat.isDestroyed()) {
    if (chat.isMinimized()) chat.restore() // 1#12①: 최소화 후 재클릭 복구
    chat.show()
    chat.focus()
    chat.webContents.send('chat:setMode', mode)
    notifyChatVisible(true)
    return
  }
  chat = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 420, // 1#10(Q5): 가로는 420 고정 · 세로만 자유 리사이즈(사용자 요청)
    maxWidth: 420,
    minHeight: 480,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    title: '미니홈',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) {
    chat.loadURL(`${url}/chat.html?mode=${mode}`)
  } else {
    chat.loadFile(join(__dirname, '../renderer/chat.html'), { query: { mode } })
  }
  chat.on('closed', () => {
    chat = null
    notifyChatVisible(false)
  })
  chat.on('minimize', () => notifyChatVisible(false))
  chat.on('restore', () => notifyChatVisible(true))
  chat.on('show', () => notifyChatVisible(true))
  chat.on('hide', () => notifyChatVisible(false))
  notifyChatVisible(true)
}

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 기본은 클릭 통과: 펫 위에 있을 때만 렌더러가 false로 토글한다.
  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('pet:load', (): PersistedState | null => loadState())
let lastPetBackupKey: string | null = null // 값이 바뀔 때만 서버 전송(15초마다 과다 호출 방지)
ipcMain.on('pet:save', (_e, state: PersistedState) => {
  saveState(state)
  const backup = petBackup(state)
  const key = JSON.stringify({ ...backup, updated_at: '' }) // updated_at 제외하고 비교
  if (key !== lastPetBackupKey) {
    lastPetBackupKey = key
    void api.putPet(backup) // 펫 상태 백업 (실패 무시)
  }
})
// ── 서버 전송(api.js) 브리지 ──
ipcMain.on('api:logEvent', (_e, { event, screen, props }: { event: string; screen: string | null; props?: Record<string, unknown> }) =>
  api.logEvent(event, screen, props ?? {}),
)
ipcMain.handle('api:selfReport', (_e, payload: Parameters<typeof api.postSelfReport>[0]) => api.postSelfReport(payload))
ipcMain.on('pet:setClickThrough', (_e, enabled: boolean) => {
  win?.setIgnoreMouseEvents(enabled, { forward: true })
})
ipcMain.on('pet:quit', () => app.quit())
ipcMain.handle('config:load', (): HealthConfig => loadHealth())
ipcMain.on('config:save', (_e, config: HealthConfig) => {
  saveHealth(config)
  void api.putRoutines(routinesBackup(config)) // 설정 백업 (실패 무시)
  win?.webContents.send('config:changed') // 오버레이가 즉시 설정 반영
})
ipcMain.handle('intake:load', (): IntakeLog => loadIntake())
ipcMain.on('intake:save', (_e, log: IntakeLog) => saveIntake(log))
ipcMain.on('pet:notify', (_e, { title, body }: { title: string; body: string }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show()
})
// 패널 QA 디버그 → 오버레이
ipcMain.on('pet:debug', (_e, action: string) => {
  if (action === 'freshinstall') {
    // QA: 처음 설치처럼 — 데이터 수집 안내 다시 띄우고(확인 후) 랜덤 캐릭터 + 이름 설정부터
    showCollectNotice(true)
    win?.webContents.send('pet:debugForward', 'freshinstall')
    return
  }
  win?.webContents.send('pet:debugForward', action)
})
ipcMain.on('pet:showContextMenu', (_e, state: { dnd: boolean; canRebirth?: boolean }) => {
  if (!win) return
  const send = (c: string): void => win?.webContents.send('pet:menuCommand', c)
  // 메뉴 간소화: 돌봄 3 + 미니홈 + 방해금지 + 종료 (설정·상태·숨김은 미니홈/트레이로)
  // 환생 가능(누적 6,750) 시에만 '다음 친구 만나기' 노출 (기획서 v13/v14)
  Menu.buildFromTemplate([
    { label: '밥 주기 🍚', click: () => send('feed') },
    { label: '쓰다듬기 🖐️', click: () => send('pat') },
    { label: '산책시키기 🚶', click: () => send('walk') },
    { type: 'separator' as const },
    ...(state?.canRebirth
      ? [{ label: '다음 친구 만나기 🥚', click: () => send('nextchar') }, { type: 'separator' as const }]
      : []),
    { label: '미니홈 🏠', click: () => openChatWindow('heart') },
    { type: 'separator' as const },
    { label: state?.dnd ? '방해금지 끄기 🔔' : '방해금지 켜기 🔕', click: () => send('dnd') },
    { label: '종료', click: () => app.quit() },
  ]).popup({ window: win })
})

ipcMain.on('care:openChat', (_e, mode: 'med' | 'heart' | 'settings') => openChatWindow(mode))
// 챗 창에서 '1분 쉬어가기' → 오버레이의 완화 흐름 실행
ipcMain.on('care:relief', () => win?.webContents.send('pet:menuCommand', 'relief'))

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

// 중복 실행 방지(1#8) — 두 번째 실행은 종료하고 기존 창을 앞으로 가져온다
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
  }
  if (chat && !chat.isDestroyed()) {
    if (chat.isMinimized()) chat.restore()
    chat.show()
    chat.focus()
  }
})

// 데이터 수집 안내 팝업 — 첫 실행(미고지) 또는 QA 강제(force=true) 시 노출
function showCollectNotice(force = false): void {
  const health = loadHealth()
  if (!force && health.noticeShown) return
  dialog.showMessageBoxSync({
    type: 'info',
    title: '케어퐁 — 데이터 수집 안내',
    message: '케어퐁은 스트레스 감지를 위해 키보드·마우스 사용 패턴만 분석해요.',
    detail:
      '· 실제 입력한 글자·비밀번호·화면 내용은 저장하지 않아요 (횟수·타이밍 패턴만).\n' +
      '· 감지·수집은 평일 업무시간(08:30~18:30)에만 이뤄져요.\n' +
      '· 모든 설정·기록은 이 컴퓨터에만 로컬 저장돼요 (서버 계정 없음).',
    buttons: ['확인'],
    noLink: true,
  })
  saveHealth({ ...loadHealth(), noticeShown: true })
}

app.whenReady().then(async () => {
  // ── 첫 실행 수집 안내(1#2) — 이름 입력(이름짓기)보다 먼저. [확인]을 눌러야 펫 창이 뜬다 ──
  showCollectNotice()

  createWindow()
  createTray()
  initStressManager()
  initDrugSearch()

  // ── 서버 전송 모듈 초기화 (호출위치표 A) — CP 번호는 앱이 로컬 발급한 회원번호 ──
  const cpNumber = loadHealth().memberId ?? 'CP-UNSET'
  try {
    await api.init({
      cpNumber,
      deviceId: cpNumber, // 1차: 회원번호를 기기 식별자로 사용 (D07 인증 전 임시)
      appVersion: app.getVersion(),
      dataDir: app.getPath('userData'),
    })
  } catch (e) {
    console.warn('[main] api.init 실패(오프라인 진행):', (e as Error).message)
  }
  api.logEvent('app_start', null, { os: process.platform, version: app.getVersion() })
  // 5분 하트비트 + 앱 상태 (호출위치표 A)
  heartbeatTimer = setInterval(() => {
    api.logEvent('heartbeat', null, {})
    const mem = process.memoryUsage()
    api.logEvent('app_health', null, { mem: Math.round(mem.rss / 1048576), events_dropped: 0, crash: false })
  }, 5 * 60 * 1000)

  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true })
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 종료 직전: 남은 이벤트 묶어 전송 (호출위치표 A)
app.on('before-quit', async (e) => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    api.logEvent('app_quit', 'P01', { src: 'menu', hour: new Date().getHours() })
    e.preventDefault()
    try {
      await api.flushEvents()
    } catch {
      /* 전송 실패해도 종료는 진행 */
    }
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
