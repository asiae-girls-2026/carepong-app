// 화면기획서 캡처 — dev 서버(localhost:5174)가 떠 있어야 한다.
//   cd ~/Desktop/케어퐁/app && npm run dev   (별도 터미널)
//   PLAYWRIGHT_DIR=<playwright-core가 설치된 package.json 경로> node scripts/capture_screens.mjs
import { createRequire } from 'module'
import { mkdirSync } from 'fs'

const require = createRequire(process.env.PLAYWRIGHT_DIR ?? import.meta.url)
const { chromium } = require('playwright-core')

const EXE =
  '/Users/chaewon/Library/Caches/ms-playwright/chromium-1228/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const BASE = 'http://localhost:5174'
const OUT = decodeURIComponent(new URL('../docs/captures/', import.meta.url).pathname)
mkdirSync(OUT, { recursive: true })

const DESKTOP_BG = `
  html, body { height: 100%; }
  * { cursor: none !important; }
`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: EXE })

// ── 공용 스텁 ──
function overlayInit(opts = {}) {
  return `(() => {
    const o = ${JSON.stringify(opts)}
    const now = Date.now()
    const dayKey = Math.floor(now / 86400000)
    const pet = Object.assign({
      name: '퐁이', creature: 'cat', stage: 3, xp: 1200,
      stats: { health: 82, happiness: 74, energy: 61 }, birthday: now, generation: 2,
      ancestors: [{ creature: 'quokka', name: '쿼카몽' }],
      lifetime: { care: 12, alarms: 20, reliefs: 4, chats: 30 }, chatsDay: dayKey, chatsToday: 4,
    }, o.pet || {})
    const HH = (offMin) => { const d = new Date(now - offMin * 60000); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') }
    const meds = o.medDue
      ? [{ id: 'm1', name: '유산균', isSupplement: true, times: [HH(5)], days: [], dose: '1포', timing: 'empty_stomach', note: '미지근한 물과 함께' }]
      : [{ id: 'm1', name: '유산균', isSupplement: true, times: ['09:00'], days: [], dose: '1포', timing: 'empty_stomach' }]
    const config = {
      memberId: 'CP-7B2E91AF', medications: meds,
      water: { dailyTargetCups: 8, intervalMinutes: 90 },
      quietEnabled: true, quietHours: { start: '03:00', end: '03:05' },
      aux: { stretchMin: 60, restMin: 75 }, minimalMotion: true,
    }
    const intake = {
      medsTakenAt: o.medDue ? {} : { m1: now },
      waterDayStart: now - 3 * 3600000, waterCups: o.waterDue ? 3 : 8,
      lastDrinkAt: o.waterDue ? now - 100 * 60000 : now,
      lastStretchAt: o.stretchDue ? now - 70 * 60000 : now,
      lastRestAt: now, medConfirmed: 20, medMissed: 1,
    }
    const noop = () => {}
    window.petApi = {
      load: async () => (o.newPet ? null : { pet, position: { x: o.x ?? 230, y: o.y ?? 230 }, lastTickAt: now }),
      save: (s) => { window.__saved = s }, setClickThrough: noop, quit: noop, showContextMenu: noop,
      onMenuCommand: (cb) => { window.__menu = cb; return noop },
      loadConfig: async () => config, saveConfig: noop, onConfigChanged: () => noop,
      debug: noop, onDebug: (cb) => { window.__debug = cb; return noop },
      loadIntake: async () => intake, saveIntake: noop, notify: noop,
    }
    window.careApi = {
      searchDrug: async () => ({ items: [] }), openChat: noop, openRelief: noop,
      stressEvent: noop, setDemo: noop, snoozeAlert: noop, calm: noop,
      getStress: async () => ({ score: 12, demo: false }),
      onStress: () => noop, onStressAlert: (cb) => { window.__stress = cb; return noop }, onCalmed: () => noop,
      onChatMode: () => noop,
    }
  })()`
}

const TYLENOL = {
  name: '타이레놀정500밀리그람', company: '한국존슨앤드존슨판매',
  efficacy: '감기로 인한 발열 및 동통(통증), 두통, 신경통, 근육통, 월경통, 염좌통',
  usage: '만 12세 이상 소아 및 성인: 1회 1~2정씩 1일 3-4회(4-6시간 마다) 필요시 복용. 1일 최대 8정을 초과하지 않는다.',
  caution: '매일 세 잔 이상 정기적으로 술을 마시는 사람은 복용 전 의사·약사와 상의. 다른 아세트아미노펜 함유 제품과 병용하지 않는다.',
  bboong: '두통이나 열이 날 때 찾는 대표 진통제예요! 공복에도 먹을 수 있지만, 하루 8정은 절대 넘기면 안 되고 술과 함께는 위험해요. 4시간은 꼭 띄우고 드세요!',
}

function minihomeInit(opts = {}) {
  return `(() => {
    const o = ${JSON.stringify(opts)}
    const now = Date.now()
    const dayKey = Math.floor(now / 86400000)
    const dk = (off) => { const d = new Date(now - off*86400000); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') }
    if (o.diary) {
      localStorage.setItem('carepong-diary', JSON.stringify({
        [dk(0)]: { mood: '😣', moodLabel: '힘들어요', notes: ['보고서 마감 때문에 하루종일 시달렸다', '그래도 저녁엔 산책해서 좀 나아짐'] },
        [dk(1)]: { mood: '🙂', moodLabel: '좋아요', notes: ['발표가 생각보다 잘 끝났다!'] },
        [dk(2)]: { mood: '😐', moodLabel: '그냥 그래요', notes: [] },
      }))
    } else { localStorage.removeItem('carepong-diary') }
    const pet = Object.assign({
      name: '퐁이', creature: 'cat', stage: 3, xp: 1200,
      stats: { health: 82, happiness: 74, energy: 61 }, birthday: now, generation: 2,
      ancestors: [{ creature: 'quokka', name: '쿼카몽' }],
      lifetime: { care: 12, alarms: 20, reliefs: 4, chats: o.chats ?? 30 }, chatsDay: dayKey, chatsToday: o.hearts ?? 4,
    }, o.pet || {})
    const config = {
      memberId: 'CP-7B2E91AF',
      medications: o.meds ?? [
        { id: 'm1', name: '유산균', isSupplement: true, times: ['09:00'], days: [] },
        { id: 'm2', name: '비타민D', isSupplement: true, times: ['13:00'], days: [] },
      ],
      water: { dailyTargetCups: 8, intervalMinutes: 90 },
      quietEnabled: true, quietHours: { start: '22:00', end: '08:00' },
      aux: { stretchMin: 60, restMin: 75 },
    }
    const intake = { medsTakenAt: o.taken ? { m1: now } : {}, waterDayStart: now, waterCups: 3, lastDrinkAt: now, lastStretchAt: null, lastRestAt: null, medConfirmed: 20, medMissed: 1 }
    const noop = () => {}
    window.petApi = {
      load: async () => ({ pet, position: { x: 0, y: 0 }, lastTickAt: now }), save: noop,
      loadConfig: async () => config, saveConfig: (c) => Object.assign(config, c),
      loadIntake: async () => intake, saveIntake: (l) => Object.assign(intake, l), notify: noop,
      onMenuCommand: () => noop, onConfigChanged: () => noop, onDebug: () => noop, debug: noop,
      setClickThrough: noop, quit: noop, showContextMenu: noop,
    }
    const TY = ${JSON.stringify(TYLENOL)}
    window.careApi = {
      searchDrug: async (q) => (/타이레놀/.test(q) ? { items: [TY] } : { items: [] }),
      openChat: noop, openRelief: noop, stressEvent: noop, setDemo: noop, snoozeAlert: noop, calm: noop,
      getStress: async () => ({ score: 12, demo: false }), onStress: () => noop, onStressAlert: () => noop,
      onCalmed: () => noop, onChatMode: () => noop,
    }
  })()`
}

async function overlayPage(opts = {}, { w = 560, h = 460 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.addInitScript(overlayInit(opts))
  await page.goto(`${BASE}/index.html`)
  await page.addStyleTag({ content: DESKTOP_BG })
  await page.waitForSelector('.overlay', { timeout: 10000 })
  await sleep(800)
  return { ctx, page }
}
async function minihomePage(opts = {}, mode = 'heart') {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.addInitScript(minihomeInit(opts))
  await page.goto(`${BASE}/chat.html?mode=${mode}`)
  await page.waitForSelector('.mh__plate', { timeout: 10000 })
  await sleep(900)
  return { ctx, page }
}
const shot = async (page, name, clip, transparent = false) => {
  await page.screenshot({ path: `${OUT}${name}.png`, omitBackground: transparent, ...(clip ? { clip } : {}) })
  console.log('captured', name)
}

// ══ 오버레이 ══
{
  const { ctx, page } = await overlayPage()
  await shot(page, 'ov-pet', undefined, true)
  await page.evaluate(() => window.__menu('status'))
  await sleep(450)
  await shot(page, 'ov-gauge', undefined, true)
  await page.evaluate(() => window.__menu('feed'))
  await sleep(350)
  await shot(page, 'ov-feed', undefined, true)
  await ctx.close()
}
{
  const { ctx, page } = await overlayPage({ medDue: true, y: 250 }, { w: 560, h: 480 })
  await page.waitForSelector('.pet__reminder', { timeout: 45000 })
  await sleep(300)
  await shot(page, 'ov-rem-med', undefined, true)
  await ctx.close()
}
{
  const { ctx, page } = await overlayPage({ waterDue: true, y: 250 }, { w: 560, h: 480 })
  await page.waitForSelector('.pet__reminder', { timeout: 45000 })
  await sleep(300)
  await shot(page, 'ov-rem-water', undefined, true)
  await ctx.close()
}
{
  const { ctx, page } = await overlayPage({ stretchDue: true, y: 250 }, { w: 560, h: 480 })
  await page.waitForSelector('.pet__reminder', { timeout: 45000 })
  await sleep(300)
  await shot(page, 'ov-rem-stretch', undefined, true)
  await ctx.close()
}
{
  const { ctx, page } = await overlayPage({ y: 250 }, { w: 560, h: 480 })
  await page.evaluate(() => window.__stress({ score: 78 }))
  await sleep(400)
  await shot(page, 'ov-stress', undefined, true)
  await page.click('.rbtn--ok') // 예 → 완화 메뉴
  await page.waitForSelector('.relief__menu')
  await sleep(300)
  await shot(page, 'ov-relief-menu', undefined, true)
  await page.click('.relief__menu button:has-text("심호흡")')
  await sleep(2600)
  await shot(page, 'ov-breath', undefined, true)
  await ctx.close()
}
{
  const { ctx, page } = await overlayPage({ y: 250 }, { w: 560, h: 480 })
  await page.evaluate(() => window.__menu('relief'))
  await page.waitForSelector('.relief__menu')
  await page.click('.relief__menu button:has-text("명상")')
  await sleep(2200)
  await shot(page, 'ov-meditate', undefined, true)
  await ctx.close()
}
{
  const { ctx, page } = await overlayPage({ pet: { stage: 4, xp: 3000 } })
  await page.evaluate(() => window.__debug('maxout'))
  await page.waitForSelector('.invite-prompt')
  await sleep(400)
  await shot(page, 'ov-rebirth', undefined, true)
  await ctx.close()
}
{
  const { ctx, page } = await overlayPage({ newPet: true })
  await page.waitForSelector('.invite-prompt')
  await page.fill('.name-input', '퐁이')
  await sleep(250)
  await shot(page, 'ov-naming', undefined, true)
  await ctx.close()
}
{
  const { ctx, page } = await overlayPage()
  await page.evaluate(() => window.__menu('dnd'))
  await sleep(700)
  await shot(page, 'ov-dnd', undefined, true)
  await ctx.close()
}
for (const st of [1, 3, 5]) {
  const { ctx, page } = await overlayPage(
    { pet: { stage: st, xp: st === 1 ? 0 : st === 3 ? 800 : 5400 }, x: 85, y: 100 },
    { w: 250, h: 230 },
  )
  await shot(page, `ov-stage-${st}`, undefined, true)
  await ctx.close()
}

// ══ 미니홈 ══
{
  const { ctx, page } = await minihomePage({}, 'med')
  await shot(page, 'mh-med-entry')
  await page.click('.msg__actions button:has-text("약 등록")')
  await sleep(600)
  await shot(page, 'mh-med-how')
  await page.click('.msg__actions button:has-text("말로 등록할래")')
  await sleep(500)
  await page.fill('.mh__inputrow input', '오메가3')
  await page.click('.mh__inputrow button')
  await sleep(2300)
  await page.fill('.mh__inputrow input', '저녁')
  await sleep(200)
  await shot(page, 'mh-med-lui')
  await page.click('.mh__inputrow button')
  await sleep(2400)
  await shot(page, 'mh-med-done')
  await ctx.close()
}
{
  const { ctx, page } = await minihomePage({}, 'med')
  await page.click('.msg__actions button:has-text("약 등록")')
  await sleep(500)
  await page.click('.msg__actions button:has-text("버튼으로")')
  await sleep(500)
  await page.fill('.mh__ginput', '오메가3')
  await sleep(200)
  await shot(page, 'mh-med-gui')
  await ctx.close()
}
{
  const { ctx, page } = await minihomePage({}, 'med')
  await page.click('.msg__actions button:has-text("약 물어보기")')
  await sleep(500)
  await page.fill('.mh__inputrow input', '타이레놀')
  await page.click('.mh__inputrow button')
  await sleep(3600)
  await shot(page, 'mh-med-qa')
  await ctx.close()
}
{
  const { ctx, page } = await minihomePage({ hearts: 6, chats: 120 }, 'heart')
  await shot(page, 'mh-heart')
  await page.click('.mh__moods button:nth-child(5)')
  await sleep(2600)
  await shot(page, 'mh-heart-talk')
  await ctx.close()
}
{
  const { ctx, page } = await minihomePage(
    {
      diary: true,
      chats: 120,
      pet: {
        name: '두부', creature: 'dog', stage: 2, generation: 3,
        ancestors: [{ creature: 'cat', name: '복실이' }, { creature: 'quokka', name: '쿼카몽' }],
      },
    },
    'archive',
  )
  await page.click('.mh__diary-row')
  await sleep(400)
  await shot(page, 'mh-archive')
  await ctx.close()
}
{
  const { ctx, page } = await minihomePage({}, 'settings')
  await shot(page, 'mh-settings-1')
  await page.evaluate(() => document.querySelector('.mh__settings').scrollTo(0, 9999))
  await sleep(400)
  await shot(page, 'mh-settings-2')
  await ctx.close()
}
{
  const { ctx, page } = await minihomePage({ chats: 120, hearts: 8 }, 'heart')
  await page.click('.mh__help')
  await sleep(500)
  await shot(page, 'mh-guide-1')
  await page.evaluate(() => document.querySelector('.mh__guide').scrollTo(0, 9999))
  await sleep(300)
  await shot(page, 'mh-guide-2')
  await ctx.close()
}

await browser.close()
console.log('done →', OUT)
