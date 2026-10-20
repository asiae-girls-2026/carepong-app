import { contextBridge, ipcRenderer } from 'electron'
import type { PersistedState } from '../main/store'
import type { HealthConfig } from '../core/health'
import type { IntakeLog } from '../core/intake'
import type { UpdateInfo } from '../core/update'

const petApi = {
  load: (): Promise<PersistedState | null> => ipcRenderer.invoke('pet:load'),
  save: (state: PersistedState): void => ipcRenderer.send('pet:save', state),
  setClickThrough: (enabled: boolean): void => ipcRenderer.send('pet:setClickThrough', enabled),
  setFocusable: (on: boolean): void => ipcRenderer.send('pet:setFocusable', on), // 이름 입력 등 키보드 필요 시만 true

  quit: (): void => ipcRenderer.send('pet:quit'),
  showContextMenu: (state: { dnd: boolean; canRebirth?: boolean }): void => ipcRenderer.send('pet:showContextMenu', state),
  onMenuCommand: (cb: (command: string) => void): (() => void) => {
    const handler = (_e: unknown, command: string): void => cb(command)
    ipcRenderer.on('pet:menuCommand', handler)
    return () => ipcRenderer.removeListener('pet:menuCommand', handler)
  },
  loadConfig: (): Promise<HealthConfig> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: HealthConfig): void => ipcRenderer.send('config:save', config),
  onConfigChanged: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('config:changed', handler)
    return () => ipcRenderer.removeListener('config:changed', handler)
  },
  debug: (action: string): void => ipcRenderer.send('pet:debug', action),
  onChatVisible: (cb: (visible: boolean) => void): (() => void) => {
    const handler = (_e: unknown, visible: boolean): void => cb(visible)
    ipcRenderer.on('chat:visible', handler)
    return () => ipcRenderer.removeListener('chat:visible', handler)
  },
  onDebug: (cb: (action: string) => void): (() => void) => {
    const handler = (_e: unknown, action: string): void => cb(action)
    ipcRenderer.on('pet:debugForward', handler)
    return () => ipcRenderer.removeListener('pet:debugForward', handler)
  },
  loadIntake: (): Promise<IntakeLog> => ipcRenderer.invoke('intake:load'),
  saveIntake: (log: IntakeLog): void => ipcRenderer.send('intake:save', log),
  notify: (title: string, body: string): void => ipcRenderer.send('pet:notify', { title, body }),
  // 버전: 현재 버전 조회 / 최신 릴리스 비교 / 다운로드 링크 열기
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  sessionStart: (): Promise<number> => ipcRenderer.invoke('app:sessionStart'),
  checkUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke('app:checkUpdate'),
  // 메인이 새 버전을 발견했을 때 밀어주는 결과 구독 (미니홈을 켜 둔 채여도 상단 배너 즉시 갱신)
  onUpdateInfo: (cb: (u: UpdateInfo) => void): (() => void) => {
    const handler = (_e: unknown, u: UpdateInfo): void => cb(u)
    ipcRenderer.on('app:updateInfo', handler)
    return () => ipcRenderer.removeListener('app:updateInfo', handler)
  },
  openExternal: (url: string): void => ipcRenderer.send('app:openExternal', url),
}

contextBridge.exposeInMainWorld('petApi', petApi)

// 케어퐁: 복약 Q&A + 공감챗봇 + 스트레스 마커
import type { StressSnapshot } from '../core/stress'
import type { DrugSearchResult } from '../main/drugSearch'
import type { StressEvent, StressAlert } from '../main/stress'
import type { ChatReply, ChatTurn } from '../main/api'

const careApi = {
  searchDrug: (name: string): Promise<DrugSearchResult> => ipcRenderer.invoke('drug:search', name),
  openChat: (mode?: 'med' | 'heart' | 'settings'): void => ipcRenderer.send('care:openChat', mode ?? 'heart'),
  openRelief: (): void => ipcRenderer.send('care:relief'),
  onChatMode: (cb: (mode: 'med' | 'heart' | 'settings') => void): (() => void) => {
    const handler = (_e: unknown, mode: 'med' | 'heart' | 'settings'): void => cb(mode)
    ipcRenderer.on('chat:setMode', handler)
    return () => ipcRenderer.removeListener('chat:setMode', handler)
  },
  stressEvent: (ev: StressEvent): void => ipcRenderer.send('stress:event', ev),
  setDemo: (on: boolean): void => ipcRenderer.send('stress:demo', on),
  snoozeAlert: (): void => ipcRenderer.send('stress:snooze'),
  calm: (): void => ipcRenderer.send('stress:calm'),
  getStress: (): Promise<StressSnapshot> => ipcRenderer.invoke('stress:get'),
  onStress: (cb: (s: StressSnapshot) => void): (() => void) => {
    const handler = (_e: unknown, s: StressSnapshot): void => cb(s)
    ipcRenderer.on('stress:update', handler)
    return () => ipcRenderer.removeListener('stress:update', handler)
  },
  onStressAlert: (cb: (s: StressAlert) => void): (() => void) => {
    const handler = (_e: unknown, s: StressAlert): void => cb(s)
    ipcRenderer.on('stress:alert', handler)
    return () => ipcRenderer.removeListener('stress:alert', handler)
  },
  onCalmed: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('stress:calmed', handler)
    return () => ipcRenderer.removeListener('stress:calmed', handler)
  },
  // 아침 인사 — 08:30 이후 첫 활동 30분 후 메인이 하루 1회 보냄
  onMorningGreet: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('morning:greet', handler)
    return () => ipcRenderer.removeListener('morning:greet', handler)
  },
  // ── 서버 전송(민서 api.js) 호출 브리지 — 렌더러 동작을 메인으로 넘겨 기록/전송 ──
  // 로컬 큐 이벤트 (호출위치표 C·D): 08:30/앱시작에 묶여 자동 전송
  logEvent: (event: string, screen: string | null, props?: Record<string, unknown>): void =>
    ipcRenderer.send('api:logEvent', { event, screen, props: props ?? {} }),
  // 실시간 자가보고 (호출위치표 B): 팝업 응답·체크인
  selfReport: (payload: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('api:selfReport', payload),
  // 공감챗 (M05): 서버 /chat → Bedrock. 실패 시 reject → 렌더러가 규칙 응답으로 폴백.
  // history: 직전 대화(오래된 순, 최대 10개). 앞 얘기를 이어받게 서버에 함께 보낸다.
  chat: (message: string, history: ChatTurn[] = []): Promise<ChatReply> =>
    ipcRenderer.invoke('api:chat', { message, history }),
}

contextBridge.exposeInMainWorld('careApi', careApi)

export type PetApi = typeof petApi
export type CareApi = typeof careApi
