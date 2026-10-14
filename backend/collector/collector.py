# -*- coding: utf-8 -*-
"""케어퐁 입력 수집기 (헤드리스) — DA pillymon.py 에서 수집·집계 부분만 추출.
GUI·ESM 팝업·PPG QR 은 없음 (Electron 이 담당). 모델 판정도 없음 (서버가 담당).

동작: 전역 키·마우스 후킹(pynput) → 1분마다 판정 피처 16개 집계 → JSON 한 줄 stdout. (저장용 14개·ko_ratio 는 안 모음 — 혜윤 10/2)
활동 0 창(키+마우스 0)도 그대로 내보낸다 — 서버가 자리비움 계산에 쓴다 (혜윤 Q17). 수집 시간(08:30~18:30)은 Electron 이 프로세스를 켜고 끄는 걸로 맞춘다.
Electron 이 자식 프로세스로 띄우고 stdout 을 줄 단위로 읽어 POST /v1/windows 로 보낸다.

프라이버시: 키 '내용'·창 제목은 저장하지 않는다. 종류별 개수와 타이밍만.

실행:  python collector.py [--window 60] [--out -]      (-: stdout, 또는 파일 경로)
의존:  pip install pynput
패키징: pyinstaller --onefile --noconsole collector.py  → dist/collector.exe 를 Electron resources/ 에 동봉
"""
import sys, math, json, time, argparse, threading
from datetime import datetime, timezone, timedelta
KST = timezone(timedelta(hours=9))

FEATURES = ["SnKeyStrokes","SnChars","SnSpecialKeys","SnDirectionKeys","SnErrorKeys",
            "SnShortcutKeys","SnSpaces","CharactersRatio","ErrorKeyRatio","SnMouseAct",
            "SnLeftClicked","SnRightClicked","SnDoubleClicked","SnWheel","SnDragged","SnMouseDistance"]

def _fresh():
    return {k: 0 for k in ["SnKeyStrokes","SnChars","SnSpecialKeys","SnDirectionKeys","SnErrorKeys",
                           "SnShortcutKeys","SnSpaces","SnMouseAct","SnLeftClicked","SnRightClicked",
                           "SnDoubleClicked","SnWheel","SnDragged"]}

class Collector:
    """이벤트 → 카운터. pynput 없이도 on_* 를 직접 호출해 테스트 가능."""
    DOUBLE_CLICK_SEC = 0.4
    DRAG_MIN_PX = 20

    def __init__(self, window_sec: int = 60):
        self.window_sec = window_sec
        self.lock = threading.Lock()
        self.last_pos = None; self.pressed = set(); self._last_click_t = -9.0; self._press_pos = None   # 창 경계 넘어 유지
        self._reset()

    def _reset(self):
        self.c = _fresh(); self.mouse_dist = 0.0
        self.win_start = time.time(); self.win_start_dt = datetime.now(KST)


    # ── 키보드 (pillymon on_press/on_release 와 동일 분류) ──
    def on_press(self, key, *, is_mod=False, is_dir=False, is_err=False, is_space=False, char=None):
        with self.lock:
            self.c["SnKeyStrokes"] += 1
            if is_mod: self.pressed.add(key); self.c["SnSpecialKeys"] += 1; return
            if is_dir: self.c["SnDirectionKeys"] += 1; return
            if is_err: self.c["SnErrorKeys"] += 1; return
            if is_space: self.c["SnSpaces"] += 1; return
            if char is not None:
                if self.pressed: self.c["SnShortcutKeys"] += 1
                else: self.c["SnChars"] += 1
            else: self.c["SnSpecialKeys"] += 1

    def on_release(self, key):
        with self.lock: self.pressed.discard(key)

    # ── 마우스 ──
    def on_click(self, x, y, button, pressed):
        with self.lock:
            t = time.time()
            if pressed:
                self.c["SnMouseAct"] += 1
                if button == "left":
                    self.c["SnLeftClicked"] += 1
                    if t - self._last_click_t <= self.DOUBLE_CLICK_SEC: self.c["SnDoubleClicked"] += 1
                    self._last_click_t = t
                elif button == "right": self.c["SnRightClicked"] += 1
                self._press_pos = (x, y)
            else:
                if self._press_pos and math.hypot(x - self._press_pos[0], y - self._press_pos[1]) >= self.DRAG_MIN_PX:
                    self.c["SnDragged"] += 1
                self._press_pos = None

    def on_scroll(self, x, y, dx, dy):
        with self.lock:
            self.c["SnMouseAct"] += 1; self.c["SnWheel"] += 1

    def on_move(self, x, y):
        with self.lock:
            if self.last_pos is not None:
                self.mouse_dist += math.hypot(x - self.last_pos[0], y - self.last_pos[1])
            self.last_pos = (x, y)

    # ── 1분 집계 (pillymon snapshot 과 동일 산식, 판정 16개만) ──
    def snapshot(self) -> dict:
        with self.lock:
            s = dict(self.c); md = self.mouse_dist; W = self.window_sec; start_dt = self.win_start_dt
            self._reset()
        cr = s["SnChars"] / s["SnKeyStrokes"] if s["SnKeyStrokes"] else 0
        den = s["SnChars"] + s["SnSpaces"]; er = s["SnErrorKeys"] / den if den else 0
        s["CharactersRatio"] = round(cr, 4); s["ErrorKeyRatio"] = round(er, 4); s["SnMouseDistance"] = round(md, 1)
        return {"window_start": start_dt.isoformat(), "window_sec": W, "features": {k: s[k] for k in FEATURES}}

# ── pynput 연결 (실행 시에만) ──
def run(window_sec: int, out):
    from pynput import keyboard, mouse
    col = Collector(window_sec)
    DIRECTION = {keyboard.Key.left, keyboard.Key.right, keyboard.Key.up, keyboard.Key.down}
    ERRORKEYS = {keyboard.Key.backspace, keyboard.Key.delete}
    MODS = {keyboard.Key.ctrl, keyboard.Key.ctrl_l, keyboard.Key.ctrl_r, keyboard.Key.alt, keyboard.Key.alt_l,
            keyboard.Key.alt_r, keyboard.Key.cmd, keyboard.Key.cmd_l, keyboard.Key.cmd_r,
            keyboard.Key.shift, keyboard.Key.shift_l, keyboard.Key.shift_r}
    def kp(key):
        col.on_press(key, is_mod=key in MODS, is_dir=key in DIRECTION, is_err=key in ERRORKEYS,
                     is_space=(key == keyboard.Key.space), char=getattr(key, "char", None))
    def mc(x, y, b, p):
        col.on_click(x, y, "left" if b == mouse.Button.left else "right" if b == mouse.Button.right else "other", p)
    keyboard.Listener(on_press=kp, on_release=col.on_release).start()
    mouse.Listener(on_click=mc, on_scroll=col.on_scroll, on_move=col.on_move).start()
    poll = lambda: None
    def emit(obj) -> None:
        # 부모(앱)가 먼저 종료해 stdout 파이프가 닫히면 Windows 에선 OSError 22/BrokenPipe — 크래시 창 대신 조용히 종료
        try:
            print(json.dumps(obj, ensure_ascii=False), file=out, flush=True)
        except (OSError, ValueError):
            sys.exit(0)
    emit({"event": "started", "window_sec": window_sec})
    nxt = time.time() + window_sec
    while True:
        time.sleep(1); poll()
        if time.time() >= nxt:
            nxt += window_sec
            emit(col.snapshot())

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", type=int, default=60)
    ap.add_argument("--out", default="-")
    a = ap.parse_args()
    out = sys.stdout if a.out == "-" else open(a.out, "a", encoding="utf-8")
    try: run(a.window, out)
    except KeyboardInterrupt: pass
