# -*- coding: utf-8 -*-
"""케어퐁 디자인 에셋 리스트 xlsx — 캐릭터 전면 재제작 전제, 미니홈 꾸미기 요소 전수 리스트업.
실행: cd ~/Desktop/케어퐁/app/scripts && python3 build_design_assets_xlsx.py
"""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

OUT = '/Users/chaewon/Desktop/케어퐁/app/docs/케어퐁_디자인에셋리스트_박채원_20260929.xlsx'

TITLE_FILL = PatternFill('solid', fgColor='1F6FEB')  # 디자인 표기 블루와 통일
HEAD_FILL = PatternFill('solid', fgColor='E8F0FE')
GIF_FILL = PatternFill('solid', fgColor='FFF1DD')  # GIF(모션) 행 강조
NOTE_FILL = PatternFill('solid', fgColor='F4F2FB')
TITLE_FONT = Font(name='나눔고딕', size=13, bold=True, color='FFFFFF')
SUB_FONT = Font(name='나눔고딕', size=9, color='7A7494')
HEAD_FONT = Font(name='나눔고딕', size=10, bold=True, color='1F4FA8')
BODY_FONT = Font(name='나눔고딕', size=10)
NOTE_FONT = Font(name='나눔고딕', size=9, color='555555')
THIN = Side(style='thin', color='C9D8F0')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical='top')

wb = Workbook()
wb.remove(wb.active)


def sheet(name, title, subtitle, widths):
    ws = wb.create_sheet(name)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    n = len(widths)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n)
    c = ws.cell(1, 1, title)
    c.font = TITLE_FONT
    c.fill = TITLE_FILL
    c.alignment = Alignment(vertical='center')
    ws.row_dimensions[1].height = 24
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n)
    ws.cell(2, 1, subtitle).font = SUB_FONT
    ws.append([])
    return ws


def header(ws, cells):
    ws.append(cells)
    r = ws.max_row
    for i in range(1, len(cells) + 1):
        c = ws.cell(r, i)
        c.font, c.fill, c.border, c.alignment = HEAD_FONT, HEAD_FILL, BORDER, WRAP


def row(ws, cells, gif=False):
    ws.append(cells)
    r = ws.max_row
    for i in range(1, len(cells) + 1):
        c = ws.cell(r, i)
        c.font, c.border, c.alignment = BODY_FONT, BORDER, WRAP
        if gif:
            c.fill = GIF_FILL


def note(ws, text, span):
    ws.append([])
    r = ws.max_row
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=span)
    c = ws.cell(r, 1, text)
    c.font, c.fill, c.alignment = NOTE_FONT, NOTE_FILL, WRAP


COLS = ['ID', '에셋명', '포맷', '권장 규격', '수량', '사용 위치', '우선순위', '비고']
W = [10, 26, 10, 16, 8, 26, 9, 34]

# ── 0. 가이드 ──
ws = sheet('0.가이드', '케어퐁 디자인 에셋 제작 가이드', '작성 2026-09-29 · 박채원 · 기획서의 파란 글씨 = 본 리스트의 제작 대상', [20, 80])
header(ws, ['항목', '내용'])
row(ws, ['스타일', '32px 네이티브 픽셀아트 직접 작도(8~16색) → nearest-neighbor 정수배 확대. 필리몽에서 검증한 정석 파이프라인'])
row(ws, ['캐릭터 방침', '기존 필리몽 스프라이트는 전부 임시 — 케어퐁 오리지널 3종으로 전면 재제작'])
row(ws, ['모션 포맷', '움직임이 필요한 에셋은 GIF(또는 프레임 시퀀스 PNG) — 걷기·먹기 등. 정지 요소는 투명 PNG'])
row(ws, ['컬러 팔레트', '스카이 #CFE0F2 · 민트 #4FC493 · 코랄 #FF8A7A · 버터 #FFD98E · 라벤더 #B9AEE8 · 우드 #C9A36E · 크림 #FFFDF6'])
row(ws, ['모드 색 체계', '약지도=민트 / 마음관리=코랄 / 아카이브=황금 / 설정=그레이 — 벽지·러그·탭이 함께 전환'])
row(ws, ['네이밍', 'char{A|B|C}_lv{1-5}_{idle|walk|eat|...}.{png|gif} / room_{요소}.png / ui_{요소}.png'])
row(ws, ['우선순위', 'P0=MVP 필수(현 화면 대체) / P1=완성도(모션·상태 표정) / P2=확장(연출·장식)'])

# ── 1. 캐릭터 (전면 재제작) ──
ws = sheet('1.캐릭터', '캐릭터 — 오리지널 3종 전면 재제작', '3종 신규 디자인(현 고양이·쿼카·강아지는 임시) × 성장 5단계. 표시 크기 72/81/96/96/109px', W)
header(ws, COLS)
row(ws, ['CH-01', '캐릭터 A~C 기본(정지)', 'PNG', '32px 원본→각 단계', '15', '오버레이·미니룸·아바타', 'P0', '3종 × 5단계. idle 기본 포즈(측면)'])
row(ws, ['CH-02', '걷기 모션', 'GIF', '32px, 4~6프레임 루프', '15', '오버레이 배회·산책', 'P0', '3종 × 5단계. 좌측면 기준(우측은 코드 반전)'], gif=True)
row(ws, ['CH-03', '먹는 모션(오물오물)', 'GIF', '32px, 4~6프레임', '3', '밥 주기 연출', 'P0', '3종 × 최종단계 우선, 전 단계는 P1'], gif=True)
row(ws, ['CH-04', '눈 깜빡임', 'GIF', '32px, 2~3프레임', '3', '정지 시 아이들 연출', 'P1', '종별 1종(단계 공통 가능 여부 작가 협의)'], gif=True)
row(ws, ['CH-05', '표정 — 시무룩', 'PNG', '각 단계', '15', '행복<40', 'P1', '3종 × 5단계 (우선 최종단계 3장 P0)'])
row(ws, ['CH-06', '표정 — 졸림·수면', 'PNG', '각 단계', '15', '기력<30 / 방해금지', 'P1', 'zzz 이펙트 포함 여부 협의'])
row(ws, ['CH-07', '쓰다듬기 반응', 'GIF', '32px, 3~4프레임', '3', '쓰다듬기 연출', 'P1', '눈웃음+하트, 종별 1종'], gif=True)
row(ws, ['CH-08', '심호흡 동기 포즈', 'PNG', '32px', '3', '숨결 버블 내부', 'P1', '들숨/날숨 2포즈면 GIF 불필요(코드 스케일)'])
row(ws, ['CH-09', '알·부화 연출', 'GIF', '32px, 6~8프레임', '1', '최초 시작·환생', 'P2', '알 흔들림→부화. 공용 1종'], gif=True)
row(ws, ['CH-10', '레벨업 이펙트', 'GIF', '64px', '1', '레벨업 순간', 'P2', '반짝임 파티클(현재 텍스트 연출 대체)'], gif=True)
note(ws, 'GIF 행(주황 배경)은 모션 필수 에셋. 걷기·먹기가 최우선 — 현재는 CSS 흔들림으로 임시 처리 중', 8)

# ── 2. 미니홈·미니룸 ──
ws = sheet('2.미니홈·미니룸', '미니홈 — 꾸미기 요소 전수', '미니룸 421×138 기준. 현재 CSS·이모지로 임시 구현된 요소 전부 그래픽 대체', W)
header(ws, COLS)
row(ws, ['RM-01', '벽지 4종(모드별)', 'PNG', '타일 36px', '4', '미니룸 배경', 'P0', '민트/코랄(핑크)/황금/그레이 스트라이프 톤'])
row(ws, ['RM-02', '바닥(우드)', 'PNG', '타일 36×36px', '1', '미니룸 하단', 'P0', ''])
row(ws, ['RM-03', '창문', 'PNG', '62×48px', '1', '좌상단', 'P0', '하늘 배경 포함. 낮/밤 2버전은 P2'])
row(ws, ['RM-04', '액자(풍경화)', 'PNG', '24×24px', '1', '벽면', 'P0', '현재 🖼️ 이모지 대체'])
row(ws, ['RM-05', '벽시계', 'PNG', '18×18px', '1', '벽면', 'P0', '현재 🕐 이모지 대체'])
row(ws, ['RM-06', '책장(+책)', 'PNG', '58×46px', '1', '우측', 'P0', '현재 CSS 블록 대체'])
row(ws, ['RM-07', '침대(+베개)', 'PNG', '74×30px', '1', '좌하단 · 조상 펫 자리', 'P0', '모드색 이불 배리에이션은 P1'])
row(ws, ['RM-08', '소파', 'PNG', '30×22px', '1', '우하단', 'P1', '현재 🛋️ 이모지 대체'])
row(ws, ['RM-09', '화분', 'PNG', '18×24px', '1', '펫 옆', 'P0', '현재 🪴 이모지 대체'])
row(ws, ['RM-10', '러그 기본(모드색)', 'PNG', '84×18px', '4', '펫 발밑', 'P0', '민트/핑크/황금/그레이'])
row(ws, ['RM-11', '문패(이름표)', 'PNG9/틀', '가변', '1', '미니룸 우하단', 'P1', '나무 팻말 프레임(텍스트는 코드)'])
row(ws, ['UN-01', '언락① 노을 사진', 'PNG', '22×22px', '1', '대화 20회 보상', 'P0', '현재 🌅 이모지 대체'])
row(ws, ['UN-02', '언락② 스탠드 조명', 'PNG', '20×40px', '1', '대화 50회 보상', 'P0', '점등 빛 번짐 포함(or 2프레임 GIF P1)'])
row(ws, ['UN-03', '언락③ 디럭스 러그', 'PNG', '96×20px', '4', '대화 100회 보상', 'P0', '모드색 스트라이프'])
row(ws, ['UN-04', '언락④ 창밖 새', 'GIF', '12px, 2~3프레임', '1', '대화 200회 보상', 'P1', '창문 앞에서 콩콩'], gif=True)
row(ws, ['MH-01', '책갈피 탭 아이콘 4종', 'PNG', '16px', '4', '약지도/마음관리/아카이브/설정', 'P1', '현재 이모지(💊💛📔⚙️) 대체'])
row(ws, ['MH-02', '상태바 아이콘 4종', 'PNG', '12px', '4', '행복/건강/기력/XP', 'P1', '현재 이모지(🩷💪⚡⭐) 대체'])
row(ws, ['MH-03', '하트 게이지(채움/빈)', 'PNG', '12px', '2', '오늘의 하트 10칸', 'P1', '현재 💛🤍 대체. 채워질 때 팝 GIF는 P2'])
row(ws, ['MH-04', '기분 이모지 5종', 'PNG', '20px', '5', '마음관리 기분 체크', 'P2', '자체 제작 여부 협의(이모지 유지 가능)'])
row(ws, ['MH-05', '? 팻말 버튼', 'PNG', '27px', '1', '공략집 버튼', 'P2', '나무 팻말 톤'])
row(ws, ['MH-06', '미니홈 프레임 장식', 'PNG', '가변', '1식', '이중 프레임 모서리 등', 'P2', '싸이월드풍 코너 장식'])
note(ws, '역대 펫 카드·일기장 등 리스트 UI는 코드 렌더 유지. 위 요소 교체만으로 방 전체가 오리지널 그래픽이 됨', 8)

# ── 3. 오버레이 UI ──
ws = sheet('3.오버레이 UI', '바탕화면 오버레이 UI', '말풍선·프롬프트·완화 화면 — 현재 CSS 기본 스타일을 케어퐁 톤으로', W)
header(ws, COLS)
row(ws, ['OV-01', '말풍선 프레임(기본)', 'PNG9/틀', '가변', '1', '펫 대사', 'P1', '꼬리 포함. 텍스트는 코드'])
row(ws, ['OV-02', '알람 말풍선 프레임', 'PNG9/틀', '가변', '1', '약·물·스트레칭·휴식', 'P1', '버튼 스타일 가이드 포함'])
row(ws, ['OV-03', '스트레스 확인 프레임', 'PNG9/틀', '가변', '1', '예/아니요 프롬프트', 'P1', '코랄 포인트'])
row(ws, ['OV-04', '상태확인 게이지 카드', 'PNG9/틀', '116px 폭', '1', '상태확인·행동 후', 'P1', '바 색상 가이드 포함'])
row(ws, ['OV-05', '하트 이펙트', 'GIF', '22px, 4프레임', '1', '쓰다듬기', 'P1', '현재 💕 텍스트 대체'], gif=True)
row(ws, ['OV-06', '숨결 버블', 'PNG', '160px 원', '3', '심호흡(들숨/멈춤/날숨 톤)', 'P1', '민트/버터/라벤더 그라데이션(스케일은 코드)'])
row(ws, ['OV-07', '명상 후광', 'PNG', '200px', '1', '명상 화면', 'P2', '라벤더 방사형'])
row(ws, ['OV-08', '방해금지 배지', 'PNG', '가변', '1', '🔕 배지', 'P2', ''])
row(ws, ['OV-09', '환생 프롬프트 알 아이콘', 'PNG', '24px', '1', '환생하기 버튼', 'P2', '현재 🥚 대체'])

# ── 4. 앱 아이콘·기타 ──
ws = sheet('4.앱 아이콘·기타', '앱 아이콘·시스템', '', W)
header(ws, COLS)
row(ws, ['AP-01', '앱 아이콘', 'PNG/ICNS', '1024px 원본', '1', 'Dock·설치', 'P0', '캐릭터 A 기반'])
row(ws, ['AP-02', '메뉴바 트레이 아이콘', 'PNG', '16/32px 템플릿', '1', 'macOS 메뉴바', 'P0', '단색 실루엣(현재 임시 고양이)'])
row(ws, ['AP-03', 'OS 알림 아이콘', 'PNG', '256px', '1', '네이티브 알림', 'P1', '앱 아이콘 파생'])
row(ws, ['AP-04', '랜딩·소개용 키비주얼', 'PNG', '가변', '1식', '배포 페이지·문서', 'P2', '캐릭터 3종 단체컷'])

wb.save(OUT)
print('saved:', OUT, '| sheets:', wb.sheetnames)
