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
  raiseTop: (): void => ipcRenderer.send('pet:raiseTop'), // 스트레스 알림·완화 팝업 뜰 때 펫 창을 최상단으로
  // 듀얼모니터: 펫의 창-기준 좌표가 속한 모니터 영역(창 기준 left/top/width/height)을 돌려준다 — 완화 모달을 그 모니터 중앙에 띄우기 위함
  displayForPoint: (pt: { x: number; y: number }): Promise<{ left: number; top: number; width: number; height: number }> =>
    ipcRenderer.invoke('pet:displayForPoint', pt),

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

// 복약 서버 동기화 결과 — main medCall 의 반환 형태. data 구조는 서버 응답(미확정 필드는 unknown).
export type MedResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number | null; message: string }

// ── 복약 LUI(자연어 등록) 대화 — 서버 /v1/medication-chat/* 응답 (OpenAPI·계약서 기준) ──
// status 흐름: SELECTING_PRODUCTS → (NEED_TIME → NEED_DAYS) → READY_FOR_CONFIRMATION → confirm
export interface MedChatOption { id: string; label: string; description?: string }
export interface MedChatSchedule {
  times?: string[]
  repeat_days?: number[] // 앱 요일 체계: 0=월 … 6=일 (계약서 예시 기준)
  repeat_day_labels?: string[]
  dose_text?: string | null
}
// 서버 등록약 1건(MY_MEDICATIONS·SELECTING_REGISTERED 응답의 medications[]) — DDI 선택·조회용.
// options[].id 가 user_medication_id 로 오는 등록약 선택 단계와 함께 쓴다(F05).
export interface MedChatRegisteredMed {
  user_medication_id?: number | string
  product_name?: string
  item_type?: 'DRUG' | 'HFF'
  schedule?: MedChatSchedule
  [k: string]: unknown // 서버가 더 보내는 필드는 그대로 보존
}
// DDI 검사 결과 카드(F09) — confirm 응답에 추가되는 신규 필드. QA7 배포 후 연동.
export interface MedChatDdiSection {
  type: 'EVIDENCE' | 'RESULT' | 'CAUTION' | string
  title?: string
  items?: string[]
  product_names?: string[]
}
export interface MedChatReply {
  conversation_id: string | null // 종료·만료 시 null 로 올 수 있음
  // 서버(medication_chat.py) status 전체: time_suggestions·repeat_day_options 는 서버가 안 보내므로 없어도 동작해야 한다.
  // DDI·관리 흐름 추가: MANAGE_MEDICATION, SELECTING_REGISTERED, MY_MEDICATIONS, CONVERSATION_EXPIRED, ERROR 등도 string 으로 수용.
  status: 'NEED_INTENT' | 'NEED_PRODUCT_NAME' | 'SELECTING_PRODUCTS' | 'SELECTING_REGISTERED' | 'MY_MEDICATIONS' | 'NEED_TIME' | 'NEED_DAYS' | 'READY_FOR_CONFIRMATION' | 'MANAGE_MEDICATION' | 'COMPLETED' | 'CANCELLED' | 'CONVERSATION_EXPIRED' | 'ERROR' | string
  intent?: string // DDI_CHECK · MY_MEDICATIONS_DDI · REMINDER_CREATE · REMINDER_UPDATE 등 — 버튼·말풍선 문구 분기에 보존(F01)
  operation?: 'REMINDER_UPDATE' | 'REMINDER_DELETE' | 'MEDICATION_REPLACE' | string
  response_type?: 'options' | 'text' | string
  message: string
  options?: MedChatOption[]
  answer?: string // 서버가 있을 때만 보냄
  // 관리 화면 이동 버튼(F02·F03) — action.type 이 OPEN_MEDICATION_MANAGEMENT 면 '약 등록 관리로 이동' 버튼 노출
  action?: { type: 'OPEN_MEDICATION_MANAGEMENT' | string; label?: string }
  medications?: MedChatRegisteredMed[] // MY_MEDICATIONS·SELECTING_REGISTERED: 등록약 목록(F05)
  selected_products?: unknown[] // 등록약 DDI 선택 누적(F05) — 서버 반영값
  can_confirm?: boolean // 등록약 2~5개 선택되어 검사 가능할 때 true(F05)
  ddi_sections_version?: number // DDI 카드 구조 버전(현재 1) — 지원 버전만 카드 렌더(F09)
  ddi_sections?: MedChatDdiSection[] // DDI 결과 영역들(F09)
  error_code?: string // 서버 오류 코드(F04) — 화면에 보조 표시
  request_id?: string
  time_suggestions?: string[] // 서버 미제공 가능 — 프론트 폴백
  repeat_day_options?: { label: string; repeat_days: number[] }[] // 서버 미제공 가능 — 프론트 폴백
  schedule?: MedChatSchedule
}
// main medChatCall 의 반환 — 성공 시 data=MedChatReply, 실패 시 서버 오류 정보 보존(F04).
// 실패에도 서버가 준 한국어 message·error_code·conversation_id 를 그대로 전달해 화면이 안내에 쓴다.
export type MedChatResult =
  | { ok: true; data: MedChatReply }
  | { ok: false; status: number | null; message: string; error_code?: string; conversation_id?: string | null; request_id?: string }

// 2차 PPG(HRV) 측정 결과 — 서버 응답(명세). 완료 감지로 받는다.
export interface PpgResult {
  id?: string
  status: 'ok' | 'low_quality' | 'insufficient_beats' | 'error' | string
  score?: number // 0~100 고부하 점수
  grade?: '저' | '관찰' | '고' | string // 화면표시: 낮음/중간/높음
  verdict?: 'deny' | 'observe' | 'confirm' | string
  used_reference?: 'personal' | 'coldstart' | string
}
// 세션 감시 결과(결과 수신 / 타임아웃 / 취소 / 오류)
export type PpgWatchOutcome =
  | { kind: 'result'; sessionId: string; result: PpgResult }
  | { kind: 'timeout'; sessionId: string }
  | { kind: 'cancelled'; sessionId: string }
  | { kind: 'error'; sessionId: string; message: string }
// 오버레이 → 미니홈 HRV 자동 오픈 시 넘기는 자가보고 맥락(QR 파라미터로 실림)
export interface HrvOpenCtx {
  selfOx: 1 | 0 | null
  selfLevel: number | null
  trigger: 'manual' | 'overload' | 'morning'
}

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
  // ── 복약 2차 서버 동기화 (docs/medication-phase2-api.md) — 결과 {ok,data}|{ok:false,status} ──
  medRegister: (body: unknown): Promise<MedResult> => ipcRenderer.invoke('med:register', body),
  medPatch: (id: number | string, patch: unknown): Promise<MedResult> => ipcRenderer.invoke('med:patch', id, patch),
  medDelete: (id: number | string): Promise<MedResult> => ipcRenderer.invoke('med:delete', id),
  medList: (active?: boolean): Promise<MedResult> => ipcRenderer.invoke('med:list', active),
  medToday: (date: string, timezone?: string): Promise<MedResult> => ipcRenderer.invoke('med:today', date, timezone),
  medIntake: (id: number | string, intake: unknown): Promise<MedResult> => ipcRenderer.invoke('med:intake', id, intake),
  medIntakeBatch: (events: unknown[]): Promise<MedResult> => ipcRenderer.invoke('med:intakeBatch', events),
  medAdherence: (from: string, to: string, timezone?: string): Promise<MedResult> => ipcRenderer.invoke('med:adherence', from, to, timezone),
  // 먹었어요/나중에 → 서버 회차 결과 전송. main이 today 조회로 occurrence 매핑 + 오프라인 큐 관리.
  medReportIntake: (p: { serverId: number | string; hhmm: string; eventType: 'TAKEN' | 'SNOOZED'; occurredAt: string; date: string }): Promise<{ ok: boolean; queued?: boolean; status?: number | null }> =>
    ipcRenderer.invoke('med:reportIntake', p),
  // ── 복약 LUI(자연어 등록) 대화 브리지 — 서버 /v1/medication-chat/* (핸들러는 main, 서버호출은 api.ts call()) ──
  // 첫 문장은 conversation_id 없이, 이후 선택·시간·요일·확인은 같은 conversation_id 로 이어간다.
  medChatMessage: (message: string, conversationId?: string): Promise<MedChatResult> =>
    ipcRenderer.invoke('medchat:message', { message, conversation_id: conversationId }),
  // product_id 는 서버가 정수만 받음(문자열 422). user_medication_id 도 함께 보낼 수 있게 열어둠(민서님 규격).
  medChatSelect: (conversationId: string, productId?: number | string, userMedicationId?: number): Promise<MedChatResult> =>
    ipcRenderer.invoke('medchat:selection', {
      conversation_id: conversationId,
      product_id: typeof productId === 'string' ? Number(productId) : productId,
      user_medication_id: userMedicationId,
    }),
  medChatConfirm: (conversationId: string): Promise<MedChatResult> =>
    ipcRenderer.invoke('medchat:confirm', { conversation_id: conversationId }),
  medChatCancel: (conversationId: string): Promise<MedChatResult> =>
    ipcRenderer.invoke('medchat:cancel', { conversation_id: conversationId }),
  // ── 2차 PPG(HRV) 측정 완료 감지 (src/main/ppg.ts) ──
  // QR 띄울 때 session_id 로 감시 시작 → 측정 끝나면 onPpgResult 로 결과 1회 수신(SSE, 폴백 폴링).
  ppgWatch: (sessionId: string): void => ipcRenderer.send('ppg:watch', sessionId),
  ppgCancel: (sessionId: string): void => ipcRenderer.send('ppg:cancel', sessionId),
  onPpgResult: (cb: (o: PpgWatchOutcome) => void): (() => void) => {
    const handler = (_e: unknown, o: PpgWatchOutcome): void => cb(o)
    ipcRenderer.on('ppg:result', handler)
    return () => ipcRenderer.removeListener('ppg:result', handler)
  },
  // 2차 PPG — 오버레이 스트레스 제안([네])에서 미니홈 HRV 측정 자동 오픈. ctx=자가보고 맥락(QR 파라미터로 실림).
  openHrv: (ctx: HrvOpenCtx): void => ipcRenderer.send('care:openHrv', ctx),
  onOpenHrv: (cb: (ctx: HrvOpenCtx) => void): (() => void) => {
    const handler = (_e: unknown, ctx: HrvOpenCtx): void => cb(ctx)
    ipcRenderer.on('chat:openHrv', handler)
    return () => ipcRenderer.removeListener('chat:openHrv', handler)
  },
}

contextBridge.exposeInMainWorld('careApi', careApi)

export type PetApi = typeof petApi
export type CareApi = typeof careApi
