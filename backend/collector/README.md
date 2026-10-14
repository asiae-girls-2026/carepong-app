# collector — 입력 수집기 (헤드리스)

DA `pillymon.py` 의 수집·집계 부분만 분리. GUI·팝업·판정 없음. 1분마다 판정 피처 16개를 JSON 한 줄로 출력한다 (저장용 14개·ko_ratio 없음 — 혜윤 10/2). 활동 0 창도 그대로 출력.
최종적으로는 **desktop-client 저장소의 `resources/collector.exe`** 로 동봉된다 (여기선 개발·검증용).

## 출력 (stdout, 1줄 = 1창)
```json
{"window_start":"2026-10-07T09:31:00+09:00","window_sec":60,"features":{"SnKeyStrokes":142,...,"SnMouseDistance":5120.5}}
```
Electron 은 이 줄을 읽어 `docs/client/api.js` 의 `postWindow()` 로 보낸다 (window_id·session_id·dnd 는 Electron 이 붙임). 08:30~18:30 에만 켠다.

## 실행
```
pip install -r requirements.txt
python collector.py                 # 60초 창
python collector.py --window 5      # 테스트용 5초 창
```

## 패키징 (Windows)
```
pyinstaller --onefile --noconsole --name collector collector.py
```
→ `dist/collector.exe`. Electron 에서 `spawn(path.join(process.resourcesPath, "collector.exe"))` 후 stdout 줄 단위 파싱.

## pillymon 과의 차이
- SnDoubleClicked / SnDragged: pillymon(SWELL)은 항상 0 이었지만 여기선 0.4초 내 재클릭 / 20px 이상 드래그로 실측 (혜윤 확정 10/2, Q35: 0 고정 금지 — 1차 실측 분포로 2차 재학습 보정)
- 활동 0 창도 출력한다 (서버 정책이 자리비움 판단에 씀)
