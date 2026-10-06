# -*- coding: utf-8 -*-
"""케어퐁 화면기획서 v1.0 (2026-09-29) — 제이에스티나 원본 pptx를 복사해 슬라이드 내용만 교체
실행: cd ~/Desktop/케어퐁/app/scripts && python3 build_storyboard_ppt.py
필요: original.pptx(제이에스티나 통합본 복사본), ../docs/captures/*.png (배포 화면 기준)
"""
import copy, html
from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Emu
from pptx.oxml.ns import qn

SRC = 'original.pptx'
OUT = '/Users/chaewon/Desktop/케어퐁/app/docs/케어퐁_화면기획서_박채원_20260929_ver.0.2.pptx'
CAP = '/Users/chaewon/Desktop/케어퐁/app/docs/captures'
DATE = '2026-09-29'
SID = '20260929'

A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NSDECL = f'xmlns:a="{A}"'


def esc(t):
    return html.escape(t, quote=False)


def run_xml(text, sz=None, b=None, color=None, font=None, lang='ko-KR'):
    text = text.replace('—', '-')  # 긴 대시 금지: 작은 대시로 통일
    rpr = f'<a:rPr {NSDECL} lang="{lang}" altLang="en-US" dirty="0"'
    if sz: rpr += f' sz="{sz}"'
    if b is not None: rpr += f' b="{1 if b else 0}"'
    rpr += '>'
    if color: rpr += f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
    if font: rpr += f'<a:latin typeface="{font}"/><a:ea typeface="{font}"/>'
    rpr += '</a:rPr>'
    return f'<a:r {NSDECL}>{rpr}<a:t>{esc(text)}</a:t></a:r>'


def para_el(runs, algn=None, ln=130, aft=300):
    # 기본 행간 130% + 문단 뒤 3pt (목차 등은 ln/aft로 타이트하게)
    ppr = f'<a:pPr {NSDECL}' + (f' algn="{algn}"' if algn else '') + '>'
    ppr += f'<a:lnSpc><a:spcPct val="{ln * 1000}"/></a:lnSpc><a:spcAft><a:spcPts val="{aft}"/></a:spcAft></a:pPr>'
    return etree.fromstring(f'<a:p {NSDECL}>{ppr}{"".join(runs)}</a:p>')


def set_body(txBody, paras, ln=130, aft=300):
    for p in txBody.findall(qn('a:p')):
        txBody.remove(p)
    for item in paras:
        runs, algn = item if isinstance(item, tuple) else (item, None)
        txBody.append(para_el(runs, algn, ln=ln, aft=aft))


def set_shape_text(sh, paras, ln=130, aft=300):
    set_body(sh._element.find(qn('p:txBody')), paras, ln=ln, aft=aft)


def set_first_run_text(sh, text):
    tb = sh._element.find(qn('p:txBody'))
    ps = tb.findall(qn('a:p'))
    first_r = None
    for p in ps:
        for r in p.findall(qn('a:r')):
            if first_r is None:
                first_r = r
            else:
                p.remove(r)
        for br in p.findall(qn('a:br')):
            p.remove(br)
        if first_r is not None and first_r.getparent() is not p:
            tb.remove(p)
    if first_r is not None:
        first_r.find(qn('a:t')).text = text


def cell_set(cell, paras):
    set_body(cell._tc.find(qn('a:txBody')), paras)


def delete_shape(sh):
    sh._element.getparent().remove(sh._element)


def IN(v):
    return Inches(v)


import os as _os
_TRIM_DIR = CAP + '/_trim'
_os.makedirs(_TRIM_DIR, exist_ok=True)


def _trimmed(path):
    """투명 PNG는 알파 bbox로 여백을 잘라 임시본 사용 (12px 패딩)"""
    im = Image.open(path)
    if 'A' not in im.getbands():
        return path, im
    bbox = im.getchannel('A').getbbox()
    if not bbox or (bbox[2] - bbox[0] >= im.width - 4 and bbox[3] - bbox[1] >= im.height - 4):
        return path, im
    pad = 12
    box = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
           min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad))
    out = _TRIM_DIR + '/' + _os.path.basename(path)
    cropped = im.crop(box)
    cropped.save(out)
    return out, cropped


def fit_images(slide, paths, area, gap=0.25, top_align=True, uniform=False, bottom_align=False):
    """uniform=True: 모든 이미지에 같은 px→inch 배율(가장 큰 것 기준) — 상대 크기 보존(성장 비교용)"""
    l, t, w, h = area
    n = len(paths)
    colw = (w - gap * (n - 1)) / n
    items = []
    for path in paths:
        pth, im = _trimmed(path)
        items.append((pth, im.width, im.height))
    scale = None
    if uniform:
        scale = min(min(colw / iw, h / ih) for _, iw, ih in items)
    placed = []
    for i, (pth, iw, ih) in enumerate(items):
        if uniform:
            pw, ph = iw * scale, ih * scale
        else:
            ar = iw / ih
            pw, ph = colw, colw / ar
            if ph > h:
                ph = h
                pw = h * ar
        px = l + i * (colw + gap) + (colw - pw) / 2
        py = (t + h - ph) if bottom_align else (t if top_align else t + (h - ph) / 2)
        slide.shapes.add_picture(pth, IN(px), IN(py), IN(pw), IN(ph))
        placed.append((px, py, pw, ph))
    return placed


prs = Presentation(SRC)
slides = list(prs.slides)

# 마커 템플릿 (slide 25의 FF818A roundRect) — retrofit 전에 추출
marker_tpl = None
for sh in slides[25].shapes:
    if sh.name == '사각형: 둥근 모서리 113':
        marker_tpl = copy.deepcopy(sh._element)
if marker_tpl is None:
    raise SystemExit('marker template not found')


def add_marker(slide, num, x, y):
    el = copy.deepcopy(marker_tpl)
    off = el.find('.//' + qn('a:off'))
    off.set('x', str(IN(x)))
    off.set('y', str(IN(y)))
    for tnode in el.findall('.//' + qn('a:t')):
        tnode.text = str(num)
    slide.shapes._spTree.append(el)


# ══ 0. 표지 ══
s = slides[0]
for sh in s.shapes:
    if sh.name == 'TextBox 8':
        runs = [r for p in sh.text_frame.paragraphs for r in p.runs]
        runs[0].text = '케어퐁'
        runs[1].text = '_'
        runs[2].text = '화면기획서'
    if sh.has_table:
        t = sh.table

        def c(r_, c_, txt):
            rr = [r for p in t.cell(r_, c_).text_frame.paragraphs for r in p.runs]
            if rr: rr[0].text = txt
            for extra in rr[1:]:
                extra.text = ''

        c(0, 1, '케어퐁(CarePong) — 스트레스 케어 데스크탑 펫')
        c(1, 1, '박채원')
        c(1, 3, DATE)
        c(2, 1, 'V0.2')
        c(2, 3, DATE)

# ══ 1. 변경이력 ══
s = slides[1]
for sh in list(s.shapes):
    if sh.name == '직사각형 3':
        delete_shape(sh)
        continue
    if sh.has_table:
        tbl = sh.table._tbl
        for tr in tbl.findall(qn('a:tr'))[3:]:
            tbl.remove(tr)
        t = sh.table

        def hist(row, ver, date, who, desc):
            f = dict(sz=800, font='나눔고딕')
            cell_set(t.cell(row, 0), [([run_xml(ver, **f)], 'ctr')])
            cell_set(t.cell(row, 1), [([run_xml(date, **f)], 'ctr')])
            cell_set(t.cell(row, 2), [([run_xml(who, **f)], 'ctr')])
            cell_set(t.cell(row, 3), [[run_xml(line, **f)] for line in desc])

        hist(1, 'v.0.1', DATE, '박채원',
             ['- 케어퐁 프로토타입(배포 화면) 기준 화면기획서 최초 작성',
              '- FRONT 오버레이 8화면 + 미니홈 7화면 + APPENDIX 정책 6종'])
        hist(2, 'v.0.2', DATE, '박채원',
             ['- 표기 정리(대시), 목차 겹침 수정, 펫 캡처 투명 배경(펫만) 교체',
              '- 디자인 필요 요소 파란 표기 + 규칙서·디자인 에셋 리스트 링크'])

# ══ Index (2 일반 / 3·9·43 dim) ══
IDX = [
    ('① 개요', ['Ⅰ. Pain Point (AS-IS)', 'Ⅱ. Solution (TO-BE)', 'Ⅲ. 서비스 개요', 'Ⅳ. 정보 구조 (IA)']),
    ('② FRONT 케어펫 오버레이', [
        'Ⅰ. 펫·돌봄',
        'Ⅱ. 건강 알람 4종',
        'Ⅲ. 스트레스 개입·완화',
        'Ⅳ. 성장·만렙 환생 / Ⅴ. 방해금지',
    ]),
    ('③ HOME 미니홈', [
        'Ⅰ. 공통 프레임 (미니룸·상태바)',
        'Ⅱ. 약지도 / Ⅲ. 마음관리',
        'Ⅳ. 아카이브 (역대 펫·일기장)',
        'Ⅴ. 설정 / Ⅵ. APPENDIX',
    ]),
]
IDX_TOPS = [(2.05, 2.43), (3.45, 3.84), (4.92, 5.39)]


def rewrite_index(s, hot=None):
    dark = hot is not None
    for sh in list(s.shapes):
        if not (sh.shape_type == 1 or str(sh.shape_type).startswith('AUTO')):
            continue
        top = Emu(sh.top).inches
        for sec_i, (ht, st) in enumerate(IDX_TOPS):
            head, subs = IDX[sec_i]
            if abs(top - ht) < 0.15:
                color = ('FFFFFF' if sec_i == hot else '8C8C8C') if dark else None
                bold = (sec_i == hot) if dark else True
                set_shape_text(sh, [[run_xml(head, sz=1400, b=bold, color=color)]], ln=100, aft=0)
            elif abs(top - st) < 0.15:
                color = ('FFFFFF' if sec_i == hot else '8C8C8C') if dark else None
                bold = (sec_i == hot) if dark else None
                set_shape_text(sh, [[run_xml(t_, sz=900, b=bold, color=color)] for t_ in subs], ln=100, aft=40)


rewrite_index(slides[2])
rewrite_index(slides[3], hot=0)
rewrite_index(slides[9], hot=1)
rewrite_index(slides[43], hot=2)


def rewrite_divider(s, title, items, hot=0):
    for sh in list(s.shapes):
        if not sh.has_text_frame:
            continue
        top = Emu(sh.top).inches
        if abs(top - 3.62) < 0.2:
            set_first_run_text(sh, title)
        elif abs(top - 4.21) < 0.2:
            set_shape_text(s if False else sh, [
                [run_xml(t_, sz=1200, b=(i == hot), color='FFFFFF' if i == hot else 'B0B0B0')]
                for i, t_ in enumerate(items)
            ])


rewrite_divider(slides[11], '② FRONT 케어펫 오버레이',
                ['Ⅰ. 펫·돌봄', 'Ⅱ. 건강 알람', 'Ⅲ. 스트레스 개입·완화', 'Ⅳ. 성장·환생', 'Ⅴ. 방해금지'])
rewrite_divider(slides[45], '③ HOME 미니홈',
                ['Ⅰ. 공통 프레임', 'Ⅱ. 약지도', 'Ⅲ. 마음관리', 'Ⅳ. 아카이브', 'Ⅴ. 설정'])


def clear_content_slide(s, title):
    keep = None
    for sh in list(s.shapes):
        if sh.is_placeholder and keep is None:
            keep = sh
        else:
            delete_shape(sh)
    if keep is not None:
        set_first_run_text(keep, title)
    return s


def add_text(s, l, t, w, h, paras):
    tb = s.shapes.add_textbox(IN(l), IN(t), IN(w), IN(h))
    tb.text_frame.word_wrap = True
    set_body(tb.text_frame._txBody, paras)
    return tb


NG = '나눔고딕'

XLSX_NAME = '케어퐁_게임규칙서_박채원_20260929.xlsx'
DESIGN_XLSX = '케어퐁_디자인에셋리스트_박채원_20260929.xlsx'
DESIGN_BLUE = '1F6FEB'  # 파란 글씨 = 디자인 에셋 제작 필요 항목


def Dz(t_):
    return [run_xml(t_, sz=1000, font=NG, color=DESIGN_BLUE)]


def add_file_ref(s, l, t, w, prefix, fname, hexcolor):
    from pptx.util import Pt
    from pptx.dml.color import RGBColor
    tb = s.shapes.add_textbox(IN(l), IN(t), IN(w), IN(0.32))
    tf = tb.text_frame
    tf.word_wrap = True
    r = tf.paragraphs[0].add_run()
    r.text = prefix + fname
    r.font.size = Pt(10)
    r.font.bold = True
    r.font.name = NG
    r.font.color.rgb = RGBColor.from_string(hexcolor)
    r.hyperlink.address = fname  # docs/ 폴더 기준 상대 링크
    return tb


def add_xlsx_ref(s, l, t, w):
    return add_file_ref(s, l, t, w, '📎 상세 게임 기획·수치 전체는 엑셀 규칙서 참고 → ', XLSX_NAME, 'FD5966')


H = lambda t_: [run_xml(t_, sz=1200, b=True, font=NG, color='404040')]
Bd = lambda t_: [run_xml(t_, sz=1000, font=NG, color='404040')]
Rd = lambda t_: [run_xml(t_, sz=1000, b=True, font=NG, color='FD5966')]
GAP = lambda: [run_xml('', sz=600)]

# ══ 4. Ⅰ. Pain Point ══
s = clear_content_slide(slides[4], 'Ⅰ. Pain Point (AS-IS)')
add_text(s, 0.9, 1.1, 11.5, 5.6, [
    H('1. 업무 중 스트레스는 “쌓이는 순간”을 본인이 자각하지 못한다'),
    Bd('- 마감·집중 구간에서 타이핑이 거칠어지고 마우스가 흔들려도, 지나고 나서야 피로를 인지'),
    Bd('- 자각했을 땐 이미 목·어깨 통증, 안구 피로, 번아웃 신호로 누적된 뒤'),
    GAP(),
    H('2. 건강 루틴(복약·수분·스트레칭)은 모니터 앞에서 항상 뒷전이 된다'),
    Bd('- 복약 앱 알림은 스마트폰으로 와서, 모니터에 몰입한 순간에는 보지 못함'),
    Bd('- 기록형 앱은 돌아오는 피드백(보상·감정)이 없어 초반 며칠 뒤 이탈'),
    GAP(),
    H('3. 알림·웰니스 앱은 “무시해도 아무 일도 없어서” 무시가 학습된다'),
    Bd('- 명상·스트레칭 앱은 따로 실행해야 해 업무 맥락이 끊기고, 푸시는 알림 피로만 남김'),
    Bd('- 다마고치식 애착 육성은 검증된 리텐션 장치지만 건강 행동과 연결한 사례가 드묾'),
])

# ══ 5. Ⅱ. Solution ══
s = clear_content_slide(slides[5], 'Ⅱ. Solution (TO-BE)')
add_text(s, 0.9, 1.0, 11.5, 2.9, [
    H('키보드·마우스 리듬으로 스트레스를 “바로 알아차리는” 케어펫 — 감지 → 확인 → 1분 완화'),
    Bd('- [실시간 감지] 타이핑·마우스 리듬만 분석(내용 미수집) — 임계 초과 시 펫이 “지금 스트레스를 받고 계신가요?” 먼저 질문'),
    Bd('- [1분 완화] 예 → 숨결 버블 심호흡(4-7-8)·짧은 명상. 완료 시에만 보상, 거절 페널티 없음'),
    Bd('- [건강 루틴 게임화] 약·물·스트레칭·휴식 알람과 돌봄이 펫의 성장(XP·환생)으로 이어짐 — 죽음 없는 무압박 설계'),
    Bd('- [미니홈 허브] 싸이월드형 미니홈에서 약지도(대화·버튼 등록)와 마음관리(기분·공감 대화)를 한 곳에'),
])
fit_images(s, [f'{CAP}/ov-stress.png', f'{CAP}/ov-breath.png', f'{CAP}/mh-heart.png'],
           (1.6, 3.55, 10.1, 3.3))
add_text(s, 1.6, 6.9, 10.1, 0.3,
         [([run_xml('▲ 감지 → 예/아니요 확인 → 숨결 버블 완화 → 미니홈 마음관리', sz=800, font=NG, color='808080')], 'ctr')])

# ══ 6. Ⅲ. 서비스 개요 ══
s = clear_content_slide(slides[6], 'Ⅲ. 서비스 개요')
add_text(s, 0.9, 1.05, 5.9, 5.9, [
    H('■ 제품 정의'),
    Bd('- 케어퐁(CarePong): 데스크탑 상주형 스트레스 케어 펫'),
    Bd('- 타깃: 모니터 앞에서 하루를 보내는 2030 사무직·재택 근무자'),
    Bd('- 핵심 가치: ① 실시간 감지(리듬만) ② 무압박(죽음·벌점 없음)'),
    Bd('   ③ 애착(육성·환생·미니홈)'),
    GAP(),
    H('■ 캐릭터·성장'),
    Bd('- 캐릭터 3종: 고양이 → 쿼카 → 강아지 (환생 시 순환)'),
    Bd('- Lv.1~5, XP 누적 100/700/2,400/5,400 — 만렙 시 환생(세대+1)'),
    Bd('- 환생해도 이전 아이는 이름과 함께 미니홈에 남는다'),
    GAP(),
    H('■ 프라이버시 원칙 (고정)'),
    Rd('- 키보드·마우스의 “내용”은 절대 수집하지 않는다 — 리듬·횟수만'),
    Bd('- 모든 데이터 로컬 저장, 서버·계정 없음. 회원번호는 기기 로컬 발급'),
])
add_text(s, 7.1, 1.05, 5.3, 5.9, [
    H('■ 기술 구성'),
    Bd('- Electron + React + TypeScript, 코어 로직 순수함수 + Vitest'),
    Bd('- 창 2종: 투명 오버레이(펫) + 미니홈(420×640, 기본 창)'),
    Bd('- 챗봇 응답은 규칙 기반(Wizard-of-Oz) — LLM 교체 지점 명시'),
    GAP(),
    H('■ 화면 ID 체계'),
    Bd('- ' + SID + '-PET-P01~P08 : FRONT 케어펫 오버레이'),
    Bd('- ' + SID + '-HOME-M01~M07 : 미니홈'),
    GAP(),
    H('■ 문서 범위'),
    Bd('- 실제 배포 시 노출되는 화면 기준 (데모·QA 요소 제외)'),
    Rd('- 모든 화면은 현재 빌드의 실캡처 — 동작 확인됨'),
])

add_xlsx_ref(slides[6], 0.9, 6.72, 11.5)
add_file_ref(slides[6], 0.9, 7.02, 11.5,
             '🎨 파란 글씨 = 디자인 에셋 제작 필요(캐릭터 전면 재제작·모션 GIF) → ', DESIGN_XLSX, DESIGN_BLUE)

# ══ 7. Ⅳ. 정보 구조 (IA) ══
s = clear_content_slide(slides[7], 'Ⅳ. 정보 구조 (IA)')
add_text(s, 0.9, 1.05, 5.9, 5.9, [
    H('■ 창 구성'),
    Bd('- ① 펫 오버레이 창: 투명·전체화면·항상 위·클릭통과'),
    Bd('   펫, 알람 말풍선, 스트레스 확인·완화, 환생·이름짓기 프롬프트'),
    Bd('- ② 미니홈 창(420×640): 케어퐁의 허브 — 책갈피 탭 4종'),
    Bd('   💊 약지도 / 💛 마음관리 / 📔 아카이브 / ⚙️ 설정'),
    Bd('- ③ 메뉴바 트레이: 미니홈 / 설정 / 방해금지 / 표시·숨김 / 종료'),
    Bd('- ④ OS 네이티브 알림: 알람·스트레스 확인 시 병행 발송'),
    GAP(),
    H('■ 진입 동선'),
    Bd('- 펫 우클릭(6항목): 밥·쓰다듬기·산책 │ 미니홈 │ 방해금지 │ 종료'),
    Bd('- 설정·아카이브는 미니홈 안 아이콘 탭 — 별도 창 없음'),
])
add_text(s, 7.1, 1.05, 5.3, 5.9, [
    H('■ 데이터 (로컬 저장)'),
    Bd('- pet: 이름·외형·레벨·XP·세대·역대 펫(이름 포함)·하트'),
    Bd('- config: 복약 스케줄·물·방해금지(사용+시간)·간격·회원번호'),
    Bd('- intake: 복용/음수/스트레칭/휴식 기록·순응률'),
    Bd('- diary: 날짜별 기분·마음관리 발화 (미니홈 로컬)'),
    GAP(),
    H('■ 갱신 주기'),
    Bd('- 스탯 틱 1분(활성 시간만 감소) / 알람 점검 30초'),
    Bd('- 스트레스 지수 1초 / 미니홈 동기화 2초'),
    GAP(),
    H('■ 모드 색 체계 (미니홈)'),
    Bd('- 약지도=민트 / 마음관리=코랄 / 아카이브=황금 / 설정=그레이'),
    Bd('- 미니룸 벽지·러그·활성 탭이 모드 색으로 함께 전환'),
])

# ══ 10. ② FRONT 구성 ══
s = clear_content_slide(slides[10], '② FRONT 케어펫 오버레이 - 구성')
placed = fit_images(s, [f'{CAP}/ov-pet.png', f'{CAP}/ov-rem-med.png', f'{CAP}/ov-stress.png'],
                    (0.7, 1.55, 12.0, 4.6), gap=0.6, top_align=False)
labels = [
    ('펫 상주·돌봄', '배회 · 밥 · 쓰다듬기 · 산책 · 상태확인', 'P01, P06~P08'),
    ('건강 알람 (말풍선+버튼)', '약·물·스트레칭·휴식 → 확인 즉시 보상', 'P02'),
    ('스트레스 개입', '예/아니요 확인 → 심호흡·명상 1분', 'P03 ~ P05'),
]
for (px, py, pw, ph), (t1, t2, t3) in zip(placed, labels):
    add_text(s, px + pw / 2 - 1.9, 6.35, 3.8, 0.75, [
        ([run_xml(t1, sz=1000, b=True, font=NG, color='404040')], 'ctr'),
        ([run_xml(t2, sz=800, font=NG, color='606060')], 'ctr'),
        ([run_xml('화면 ' + t3, sz=800, b=True, font=NG, color='FD5966')], 'ctr'),
    ])
add_text(s, 0.9, 1.0, 11.5, 0.4, [
    Bd('오버레이는 투명 전체화면 창 — 평소엔 클릭통과로 업무를 막지 않고, 말풍선·프롬프트가 떠 있는 동안에만 클릭을 받는다')])


# ══ 화면 슬라이드 retrofit ══
def retrofit(s, crumb, url, sid, rows, images, markers=None, img_area=(0.3, 0.95, 8.9, 6.2), uniform=False):
    id_box = url_box = crumb_box = desc = None
    for sh in list(s.shapes):
        left, top = Emu(sh.left).inches, Emu(sh.top).inches
        if sh.has_table and left > 8.5:
            desc = sh
            continue
        if top < 0.5 and sh.shape_type == 17 and left > 10:
            id_box = sh
            continue
        if top < 0.5 and 5.5 < left < 7:
            url_box = sh
            continue
        if top < 0.5 and 1 < left < 2:
            crumb_box = sh
            continue
        delete_shape(sh)
    assert desc is not None, 'desc table missing'
    f8 = dict(sz=800)
    if crumb_box is not None:
        pre, red, post = crumb
        crumb_box.width = IN(2.45)
        set_shape_text(crumb_box, [[run_xml(pre, **f8), run_xml(red, sz=800, b=True, color='FD5966'),
                                    run_xml(post, sz=800, b=True)]])
    if url_box is not None:
        url_box.width = IN(2.45)
        set_shape_text(url_box, [[run_xml(url, **f8)]])
    if id_box is not None:
        set_shape_text(id_box, [[run_xml(sid, **f8)]])
    tbl = desc.table._tbl
    trs = tbl.findall(qn('a:tr'))
    tr0 = None
    for tr in trs:
        if len(tr.findall(qn('a:tc'))) >= 2:
            tr0 = copy.deepcopy(tr)
            break
    assert tr0 is not None, 'no 2-cell template row'
    for tr in trs:
        tbl.remove(tr)
    for _ in rows:
        tr = copy.deepcopy(tr0)
        tr.set('h', str(IN(0.62)))
        tbl.append(tr)
    t = desc.table
    for i, (head, body) in enumerate(rows):
        cell_set(t.cell(i, 0), [([run_xml(str(i + 1), sz=800)], 'ctr')])
        paras = [[run_xml(head, sz=800, b=True)]]
        for ln in body:
            if ln.lstrip().startswith('◇'):
                paras.append([run_xml(ln.replace('◇', '', 1), sz=800, color=DESIGN_BLUE)])
            else:
                paras.append([run_xml(ln, sz=800)])
        cell_set(t.cell(i, 1), paras)
    placed = fit_images(s, images, img_area, gap=0.45, top_align=False, uniform=uniform, bottom_align=uniform)
    if markers is None:
        markers = list(range(1, len(placed) + 1))
    for num, (px, py, pw, ph) in zip(markers, placed):
        if num is not None:
            add_marker(s, num, px - 0.10, py - 0.06)
    return placed


URL_OV = '케어퐁 앱 > 펫 오버레이 창'
URL_MH = '케어퐁 앱 > 미니홈 (420×640)'

# ── P01 (12) 펫·돌봄 ──
retrofit(slides[12],
         ('바탕화면 > ', '케어펫', ' – 상주·돌봄'),
         URL_OV, f'{SID}-PET-P01',
         [('[펫 오버레이]',
           ['◇ 픽셀 펫 캐릭터(오리지널 3종 재제작 대상)가 상주',
            '- 평소 클릭통과 → 바탕화면·업무 클릭을 막지 않음',
            '- 커서가 펫 위에 올라올 때만 상호작용 활성화',
            '- 앵커 기준 좌우 ±55px 배회, 드래그로 자유 이동']),
          ('[우클릭 메뉴 6항목]',
           ['- 밥 주기 🍚 / 쓰다듬기 🖐️ / 산책시키기 🚶',
            '- 미니홈 🏠 / 방해금지 켜기·끄기 / 종료',
            '- 길게누르기(0.5초)로도 동일 메뉴']),
          ('[돌봄 보상]',
           ['- 밥: 건강+8·행복+5·기력+12·XP10',
            '◇ 오물오물 먹는 모션 = GIF 제작 (CH-03)',
            '- 쓰다듬기: 건강+3·행복+12·XP10 (하트 💛 이펙트)',
            '- 산책: 10초 화면 랜덤 걷기 후 건강+10·행복+8·기력−8·XP15',
            '◇ 걷기 모션 = GIF 제작 (CH-02, 배회·산책 공용)',
            '- 기력 25 미만이면 산책 거부 말풍선']),
          ('[상태확인 게이지]',
           ['- 펫 위 카드 2.5초: Lv·세대 + 행복🩷/건강💪/기력⚡ 바',
            '- 돌봄·알람 확인 등 스탯 변동 시 자동 노출'])],
         [f'{CAP}/ov-pet.png', f'{CAP}/ov-feed.png', f'{CAP}/ov-gauge.png'],
         img_area=(0.4, 2.0, 8.7, 3.7))

# ── P02 (14) 건강 알람 4종 ──
retrofit(slides[14],
         ('바탕화면 > ', '건강 알람 4종', ' 말풍선'),
         URL_OV, f'{SID}-PET-P02',
         [('[알람 종류·발동]',
           ['- 약: 등록 스케줄 도래 시. 용량·타이밍·📌메모·놓침 가이드 표기',
            '- 물: 간격(기본 90분)마다, 하루 목표 컵 도달 시 중단',
            '- 스트레칭(기본 60분)·휴식(기본 75분): 간격 도래 시',
            '- 30초 주기 점검, 동시 1건, OS 알림 병행']),
          ('[응답 버튼·보상]',
           ['- 약 “먹었어요”: 기력+10·XP10 / 물 “마셨어요”: 건강+5·XP5',
            '- 스트레칭 “했어요”: 건강+5·행복+3·XP5',
            '- 휴식 “쉬었어요”: 행복+5·기력+5·XP5',
            '- “나중에”: 10분 스누즈']),
          ('[무응답·무벌점 원칙]',
           ['- 45초 무응답 시 자동 닫힘 — 게이지 벌점 없음',
            '- 복약만 놓침 횟수 기록(순응률 통계용)',
            '- 방해금지·밤에는 발동하지 않음']),
          ('[끌 수 없는 알람]',
           ['- 스트레칭·휴식은 건강 펫의 기본 — 간격만 조절 가능(최소 10분)'])],
         [f'{CAP}/ov-rem-med.png', f'{CAP}/ov-rem-water.png', f'{CAP}/ov-rem-stretch.png'],
         img_area=(0.3, 1.3, 8.9, 5.6))

# ── P03 (16) 스트레스 확인 프롬프트 ──
retrofit(slides[16],
         ('바탕화면 > ', '스트레스 확인', ' 프롬프트'),
         URL_OV, f'{SID}-PET-P03',
         [('[감지 → 확인 흐름]',
           ['- 타이핑·마우스 리듬(60초 창·EMA)으로 지수 상시 계산',
            '- 지수는 화면에 노출하지 않음 — 임계(70) 초과 시에만 개입',
            '- 문구: “스트레스를 받고 계신 것 같아요 🥺',
            '   지금 스트레스를 받고 계신가요?” + OS 알림 병행']),
          ('[예 (Primary)]',
           ['- 완화 메뉴 오버레이로 이동 (화면 P04)']),
          ('[아니요]',
           ['- 10분 스누즈 + “다행이에요! 괜히 걱정했네요 😊” 말풍선',
            '- 오탐(false positive) 라벨로도 활용 가능(감지 보정)']),
          ('[무압박 상한]',
           ['- 하루 개입 3회 + 쿨다운 30분 — 중복 개입 차단',
            '- 방해금지·밤, 다른 프롬프트 노출 중엔 개입 안 함']),
          ('[프라이버시]',
           ['- 키·마우스의 내용은 절대 수집하지 않음 — 리듬·횟수만'])],
         [f'{CAP}/ov-stress.png'],
         img_area=(2.2, 1.3, 4.8, 5.8))

# ── P04 (18) 완화 — 심호흡 ──
retrofit(slides[18],
         ('스트레스 확인 > ', '완화 – 심호흡', ''),
         URL_OV, f'{SID}-PET-P04',
         [('[완화 메뉴]',
           ['- 2종 선택: 심호흡(4-7-8×3, 약 1분) / 짧은 명상(약 1분 30초)',
            '- “지금은 괜찮아요” = 보상 없이 닫기, 페널티 없음']),
          ('[숨결 버블 (심호흡)]',
           ['- 펫이 든 버블이 들이쉬기 4초간 크게 팽창(×1.18),',
            '   내쉬기 8초간 수축(×0.55) — 따라 쉬도록 유도',
            '- 단계 라벨 색 구분: ↑들이쉬세요(민트) / ●멈추세요(버터,',
            '   반짝임) / ↓내쉬세요(라벤더). 화살표는 상하로 살랑임']),
          ('[타이밍 표기]',
           ['- 남은 초 카운트다운 배지(우하단 짙은 원)',
            '- 회차 점 ●●○ (3회 중 몇 번째 호흡인지)']),
          ('[완료 보상]',
           ['- 지수 리셋 + 행복+10·기력+8·XP15',
            '- “잘하셨어요! 스트레스 지수가 내려갔어요” 완료 화면'])],
         [f'{CAP}/ov-relief-menu.png', f'{CAP}/ov-breath.png'],
         img_area=(0.6, 1.8, 8.3, 4.2))

# ── P05 (19) 완화 — 명상 ──
retrofit(slides[19],
         ('스트레스 확인 > ', '완화 – 짧은 명상', ''),
         URL_OV, f'{SID}-PET-P05',
         [('[가이드 명상 90초]',
           ['- 15초마다 안내 문구가 페이드로 전환(총 6문장)',
            '   “숨이 들어오고 나가는 것만 가만히 느껴보세요” 등',
            '- 펫 뒤 라벤더 후광이 6초 주기로 은은하게 맥동']),
          ('[진행 표기]',
           ['- 전체 진행 바(라벤더) + 남은 초',
            '- “저도 옆에서 같이 고요히 있을게요” 동반 카피']),
          ('[중단·완료]',
           ['- “그만하기” 중도 종료 — 보상 없음, 페널티도 없음',
            '- 완료 시 지수 리셋 + 행복+10·기력+5·XP15'])],
         [f'{CAP}/ov-meditate.png'],
         img_area=(2.0, 1.7, 5.4, 4.4))

# ── P06 (20) 성장 ──
retrofit(slides[20],
         ('바탕화면 > ', '성장 Lv.1~5', ''),
         URL_OV, f'{SID}-PET-P06',
         [('[XP·레벨]',
           ['- XP 누적 100 / 700 / 2,400 / 5,400 도달 시 Lv.2~5',
            '- 획득처: 돌봄·알람 이행·완화 완료·미니홈 대화',
            '- 레벨업 시 ✨LEVEL UP✨ 이펙트 + 말풍선']),
          ('[외형 변화]',
           ['◇ 단계별 스프라이트 3종×5단계 전면 재제작 (CH-01)',
            '- 표시 크기 72→81→96→96→109px, 얼굴 일정·몸만 커짐',
            '◇ 시무룩·졸림·수면 표정 배리에이션 (CH-05·06)']),
          ('[게이지·표정]',
           ['- 행복<40 시무룩 / 기력<30 졸림 표정',
            '- 게이지 0이어도 죽지 않음 — 무압박 원칙'])],
         [f'{CAP}/ov-stage-1.png', f'{CAP}/ov-stage-3.png', f'{CAP}/ov-stage-5.png'],
         markers=[1, 1, 1],
         img_area=(0.8, 1.9, 7.9, 4.2), uniform=True)

# ── P07 (22) 환생·이름짓기 ──
retrofit(slides[22],
         ('바탕화면 > ', '만렙 환생·이름짓기', ''),
         URL_OV, f'{SID}-PET-P07',
         [('[만렙 환생 프롬프트]',
           ['- Lv.5(5,400 XP) 도달 시: “만렙이 됐어요! 졸업하고,',
            '   새로운 모습의 아기로 환생할까요?”',
            '- 세대 안내 포함: “세대는 N번째로 이어지고, 기록은 남아요”',
            '- [환생하기 🥚] / [조금 이따가] — 언제든 다시 가능']),
          ('[환생 처리]',
           ['- 리셋: Lv→1, XP→0, 게이지→70 / 유지: 세대+1, 평생 기록',
            '- 외형은 다음 캐릭터로 순환 (고양이→쿼카→강아지)',
            '- 이전 아이는 이름과 함께 기록 → 미니홈에 작게 남음']),
          ('[이름짓기]',
           ['- 최초 실행·환생 직후 공통 프롬프트',
            '- “N번째 아이가 태어났어요! 이름을 지어주세요”',
            '- 최대 12자, Enter/확인. 미입력 시 기존 이름 유지'])],
         [f'{CAP}/ov-rebirth.png', f'{CAP}/ov-naming.png'],
         img_area=(0.5, 1.4, 8.5, 5.4))

# ── P08 (27) 방해금지 ──
retrofit(slides[27],
         ('바탕화면 > ', '방해금지·수면', ''),
         URL_OV, f'{SID}-PET-P08',
         [('[진입 2경로]',
           ['- 수동: 우클릭·트레이 토글(라벨 동적: 켜기/끄기)',
            '- 자동: 설정의 방해금지 시간(기본 22:00~08:00)',
            '   설정에서 “사용/미사용” 선택 가능 — 미사용이면 자동 없음']),
          ('[방해금지 중]',
           ['- 알람·스트레스 개입 전면 중단',
            '- 펫 수면 모션 + 투명도 40% + 🔕 배지',
            '- 기력 +4/분 회복 — “쉬면 회복” 루프']),
          ('[해제]',
           ['- 토글 오프 또는 아침 시간 도래',
            '- “다시 곁에 있을게요” 말풍선'])],
         [f'{CAP}/ov-dnd.png'],
         img_area=(2.2, 1.4, 4.8, 5.6))

# ══ 44. ③ HOME 구성 ══
s = clear_content_slide(slides[44], '③ HOME 미니홈 - 구성')
placed = fit_images(s, [f'{CAP}/mh-med-entry.png', f'{CAP}/mh-heart.png', f'{CAP}/mh-archive.png'],
                    (1.2, 1.5, 10.8, 4.7), gap=0.7, top_align=True)
labels = [
    ('💊 약지도', '복약 체크 · 등록(대화/버튼) · Q&A', 'M02 ~ M04'),
    ('💛 마음관리', '기분 체크 · 공감 대화 · 쉬어가기', 'M05'),
    ('📔 아카이브 · ⚙️ 설정', '역대 펫 · 일기장 · 알람/약 관리', 'M06 ~ M07'),
]
for (px, py, pw, ph), (t1, t2, t3) in zip(placed, labels):
    add_text(s, px + pw / 2 - 1.9, 6.35, 3.8, 0.75, [
        ([run_xml(t1, sz=1000, b=True, font=NG, color='404040')], 'ctr'),
        ([run_xml(t2, sz=800, font=NG, color='606060')], 'ctr'),
        ([run_xml('화면 ' + t3, sz=800, b=True, font=NG, color='FD5966')], 'ctr'),
    ])
add_text(s, 0.9, 1.0, 11.5, 0.4, [
    Bd('미니홈은 케어퐁의 기본 창 — 싸이월드 미니홈피 문법(미니룸·책갈피 탭·문패)으로, 펫의 집에 놀러가 모든 기능을 쓴다')])

# ── M01 (46) 공통 프레임 ──
retrofit(slides[46],
         ('미니홈 > ', '공통 프레임', ' – 미니룸·상태'),
         URL_MH, f'{SID}-HOME-M01',
         [('[상단 바]',
           ['- “{펫이름}의 미니홈” 타이틀 + ? 공략집 버튼(나무 팻말)',
            '- 공략집: 펫 소개(감지+프라이버시)·게이지 표·레벨업',
            '   지름길·하루 루틴·방 꾸미기 체크리스트·환생 안내']),
          ('[미니룸 — 전 요소 그래픽 제작 대상]',
           ['◇ 벽지 4모드·바닥·창문·액자·시계·책장·침대·소파·',
            '   화분·러그 (RM-01~11)',
            '◇ 언락 가구 4종: 노을 사진·스탠드 조명·디럭스 러그·',
            '   창밖 새(GIF) (UN-01~04)',
            '- 문패: 이름·Lv·N번째 아이 (프레임만 제작, 텍스트 코드)',
            '- 환생한 이전 아이가 침대 위·화분 옆에 작게 남음']),
          ('[상태 바 4종]',
           ['- 행복/건강/기력/XP 미니바 상시 표시',
            '◇ 상태바·탭·하트 아이콘 = 자체 제작 (MH-01~03)',
            '- 호버 즉시 툴팁: 수치 + 올리는 법 2줄']),
          ('[오늘의 하트]',
           ['- 10칸 💛 — 대화·기분 체크마다 +1(하트 팝 애니메이션)',
            '- 만땅 시 보너스 XP+10 + 펫 축하 말풍선, 자정 리셋']),
          ('[책갈피 탭]',
           ['- 약지도·마음관리(글자) + 아카이브📔·설정⚙️(아이콘)',
            '- 활성 탭이 모드 색으로 칠해지고 살짝 돌출'])],
         [f'{CAP}/mh-heart.png', f'{CAP}/mh-guide-1.png'],
         img_area=(0.7, 1.3, 8.1, 5.5))

# ── M02 (25) 약지도 — 진입·분기 ──
retrofit(slides[25],
         ('미니홈 > ', '약지도', ' – 진입·등록 분기'),
         URL_MH, f'{SID}-HOME-M02',
         [('[오늘의 복약 카드]',
           ['- 등록 약 목록 + “n/m 완료” + 항목별 [먹었어요] 버튼',
            '- 체크 시 오버레이 알람과 저장소 공유 → 중복 알림 없음',
            '- 완료 항목은 ✅ + 흐림 처리']),
          ('[말풍선 버튼 진입]',
           ['- 첫마디: “약에 대한 궁금한 건 모두 물어보세요! 💊”',
            '- 버튼 2종: [💊 약 등록] / [🔍 약 물어보기]',
            '- 누른 버튼은 사라져 중복 클릭 방지, 완료 후 재노출']),
          ('[등록 방식 분기]',
           ['- “좋아요! 어떻게 등록할까요?”',
            '- [💬 말로 등록할래] / [📝 버튼으로 등록할래] / [↩️ 처음으로]',
            '- 모든 단계에 [처음으로] — 초기 선택지로 복귀'])],
         [f'{CAP}/mh-med-entry.png', f'{CAP}/mh-med-how.png'],
         img_area=(0.7, 1.3, 8.1, 5.5))

# ── M03 (26) 약지도 — 말로 등록(LUI) ──
retrofit(slides[26],
         ('약지도 > ', '말로 등록 (LUI)', ''),
         URL_MH, f'{SID}-HOME-M03',
         [('[가이드 위저드]',
           ['- 펫이 순서대로 질문: ① 약 이름 → ② 시간',
            '- 시간 어휘: 아침(09:00)/점심(13:00)/저녁(19:00)/',
            '   자기 전(22:00)/공복(07:00)/“21시 30분”·“HH:MM”',
            '- 못 알아들으면 예시와 함께 재질문(벌점 없음)']),
          ('[한 줄 명령]',
           ['- “유산균 아침 등록”처럼 한 문장으로도 즉시 등록',
            '- 등록/추가/챙겨줘 등의 동사 감지']),
          ('[등록 완료]',
           ['- “오메가3, 저녁(19:00) · 매일로 등록했어요!” 확인 메시지',
            '- 오늘의 복약 카드에 즉시 반영, 진입 버튼 재노출',
            '- 고정 고지: “약은 처방·약사 지시가 우선이에요”']),
          ('[조회]',
           ['- “오늘 약 보여줘” → 체크 현황 목록 답변'])],
         [f'{CAP}/mh-med-lui.png', f'{CAP}/mh-med-done.png'],
         img_area=(0.7, 1.3, 8.1, 5.5))

# ── M04 (28) 약지도 — 폼 등록·Q&A ──
retrofit(slides[28],
         ('약지도 > ', '버튼 등록·약 Q&A', ''),
         URL_MH, f'{SID}-HOME-M04',
         [('[버튼(폼) 등록]',
           ['- “여기에 바로 입력해 주세요!” 말풍선 안에 폼 임베드',
            '- 이름 입력 + 시간 피커(+ 시간으로 복수) + [등록]',
            '- 제출하면 폼이 접히고 확인 메시지로 전환']),
          ('[약 Q&A]',
           ['- [약 물어보기] 후엔 버튼 없이 연속 질문 흐름',
            '- 답변: 쉬운 설명(존댓말) 타이핑 효과 + 의약품 정보 카드',
            '   (제품명·업체·효능·복용법·주의 — 식약처 e약은요 기반)',
            '- 미등록 약명은 정확한 이름 재질문']),
          ('[고지]',
           ['- 하단 상시: “의약품 정보는 참고용이에요.',
            '   약은 처방·약사 지시가 우선이에요.”'])],
         [f'{CAP}/mh-med-gui.png', f'{CAP}/mh-med-qa.png'],
         img_area=(0.7, 1.3, 8.1, 5.5))

# ── M05 (29) 마음관리 ──
retrofit(slides[29],
         ('미니홈 > ', '마음관리', ' – 기분·공감 대화'),
         URL_MH, f'{SID}-HOME-M05',
         [('[첫마디·기분 체크]',
           ['- “집사님, 오늘은 어떤 힘든 일이 있으셨나요?',
            '   저랑 같이 이야기해봐요! 💛”',
            '- 기분 5종: 😄최고/🙂좋아/😐그냥/😞지침/😣힘듦',
            '- 고르면 카드가 사라지고 펫이 기분별 공감 응답']),
          ('[공감 대화]',
           ['- 상호 돌봄형 페르소나(다정한 존댓말·집사님 호칭)',
            '- 키워드별 공감 응답 + 힘듦·불안 감지 시',
            '   [🫧 1분 쉬어가기] 버튼을 응답에 붙여 완화로 연결']),
          ('[안전 레이어 (고정)]',
           ['- 위기 표현 감지 시 톤을 낮추고 즉시 안내:',
            '   자살예방상담 109 · 정신건강 위기상담 1577-0199',
            '- 하단 상시: “케어펫은 상담사·의사가 아니라 친구예요”']),
          ('[기록]',
           ['- 기분·발화는 날짜별로 마음 일기장에 자동 기록 (M06)'])],
         [f'{CAP}/mh-heart.png', f'{CAP}/mh-heart-talk.png'],
         img_area=(0.7, 1.3, 8.1, 5.5))

# ── M06 (30) 아카이브 ──
retrofit(slides[30],
         ('미니홈 > ', '아카이브', ' – 역대 펫·일기장'),
         URL_MH, f'{SID}-HOME-M06',
         [('[역대 펫]',
           ['- 3칸×2줄 동일 크기 카드 그리드 — 현재 아이 맨 앞',
            '   (주황 테두리 강조), 이후 최신순',
            '- 카드에는 펫 이름만 표기 (세대 문구 없음)',
            '- 6개 초과 시 카드 제목 우측 ◀▶로 페이지 넘김']),
          ('[마음 일기장]',
           ['- 날짜별 행: 날짜 + 기분 이모지 + 첫마디 미리보기',
            '- 행 클릭 시 두세 줄 요약 펼침:',
            '   기분 한 줄 + 그날 남긴 말 발췌 2줄',
            '- 5일씩 페이지 넘김(◀▶), 펼침은 페이지 전환 시 접힘']),
          ('[데이터 원칙]',
           ['- 기분·발화는 기기 로컬에만 저장, 서버 전송 없음',
            '- 하루 최대 8개 발화, 각 80자까지 보관'])],
         [f'{CAP}/mh-archive.png'],
         img_area=(2.0, 1.4, 5.4, 5.3))

# ── M07 (31) 설정 ──
retrofit(slides[31],
         ('미니홈 > ', '설정', ' – 알람·약·회원번호'),
         URL_MH, f'{SID}-HOME-M07',
         [('[알람 간격]',
           ['- 물 목표(컵)·알림 간격(분, 최소 20)',
            '- 스트레칭·휴식 간격(분, 최소 10) — 끌 수 없음(건강 펫 원칙)']),
          ('[방해금지 · 펫]',
           ['- “방해금지 시간 사용” 토글 먼저 → 켰을 때만 시작/끝 노출',
            '- 펫 움직임 최소화 체크(배회 정지)']),
          ('[약 등록 · 관리]',
           ['- 등록 약 목록(시간 표기) + 삭제',
            '- 폼 등록: 이름 + 시간 피커(복수) + [등록]',
            '- 안내: “약지도 탭에서는 케어펫과 대화로도 등록할 수 있어요”']),
          ('[회원번호]',
           ['- CP-XXXXXXXX — 최초 실행 시 자동 발급, [복사] 버튼',
            '- 데이터 관리·조인 키(person_id) 용도',
            '- 고지: “이름이나 연락처와는 연결되지 않아요”'])],
         [f'{CAP}/mh-settings-1.png', f'{CAP}/mh-settings-2.png'],
         img_area=(0.7, 1.3, 8.1, 5.5))

# ══ APPENDIX ══
s = clear_content_slide(slides[33], '(Appendix) 1. 게임 로직 — 게이지·XP 수치')
add_text(s, 0.9, 1.05, 5.9, 5.9, [
    H('■ 게이지 3종 (0~100, 초기 70)'),
    Bd('- 자연 감소(활성 시간 기준): 행복 −16 / 건강 −12 / 기력 −20 per 일'),
    Bd('- 앱을 꺼둔 시간은 감소 없음(오프라인 급감 금지)'),
    Bd('- 0이 되어도 죽지 않음 — 시무룩·졸림 표현만'),
    GAP(),
    H('■ 행동별 증감·XP'),
    Bd('- 밥 🍚: 건강+8 행복+5 기력+12 · XP10'),
    Bd('- 쓰다듬기 🖐️: 건강+3 행복+12 · XP10'),
    Bd('- 산책 🚶: 건강+10 행복+8 기력−8 · XP15'),
    Bd('- 알람 이행: 약 기력+10·XP10 / 물 건강+5·XP5'),
    Bd('   / 스트레칭 건강+5 행복+3·XP5 / 휴식 행복+5 기력+5·XP5'),
    Bd('- 완화 완료: 심호흡 행복+10 기력+8 / 명상 행복+10 기력+5 · XP15'),
    Bd('- 미니홈 대화·기분 체크: 행복+1 · XP2 (하루 10회, 만땅 보너스 XP10)'),
])
add_text(s, 7.1, 1.05, 5.3, 5.9, [
    H('■ 레벨·환생'),
    Bd('- XP 누적 임계: Lv.2=100 / Lv.3=700 / Lv.4=2,400 / Lv.5=5,400'),
    Bd('- 만렙 초과 XP는 버림(환생 대기)'),
    Bd('- 환생: Lv1·XP0·게이지70 리셋 / 세대+1·평생 기록·이름 유지'),
    Bd('- 캐릭터 순환: 고양이 → 쿼카 → 강아지 → 고양이…'),
    GAP(),
    H('■ 기력 과다 리미트'),
    Bd('- 기력 ≥95가 30분 지속되면 “무리 주의” 말풍선 1회'),
    Bd('- 고정 문구: “약은 처방·약사 지시가 우선이에요”'),
    GAP(),
    Rd('※ 모든 수치는 규칙서(9/22) 기반 초기 제안값 — 플레이 테스트로 확정'),
])

add_xlsx_ref(slides[33], 0.9, 6.72, 11.5)
add_file_ref(slides[33], 0.9, 7.02, 11.5, '🎨 디자인 에셋 리스트 → ', DESIGN_XLSX, DESIGN_BLUE)

s = clear_content_slide(slides[34], '(Appendix) 2. 스트레스 감지·개입 정책')
add_text(s, 0.9, 1.05, 5.9, 5.9, [
    H('■ 감지 산식'),
    Bd('- 최근 60초 이동 창에서 마커 가중 합산:'),
    Bd('   타이핑 속도 0.28 / 백스페이스 비율 0.27'),
    Bd('   / 마우스 급가속 0.30 / 클릭 빈도 0.15'),
    Bd('- EMA(α=0.18) 평활화 — 순간 튐 방지, 1초 주기 갱신'),
    Bd('- 수집 범위: 마우스 이동=전역 / 키·클릭=앱 창 내'),
    Rd('- 키 입력의 내용은 저장하지 않음 — 리듬·횟수만'),
    GAP(),
    H('■ UI 원칙'),
    Bd('- 지수·게이지를 화면에 노출하지 않음 (감시감 제거)'),
    Bd('- 개입은 “지금 스트레스를 받고 계신가요?” 예/아니요 확인부터'),
])
add_text(s, 7.1, 1.05, 5.3, 5.9, [
    H('■ 개입 정책'),
    Bd('- 발동: 지수 > 70 + 방해금지 아님 + 다른 프롬프트 없음'),
    Bd('- 하루 상한 3회 · 쿨다운 30분 · “아니요” 시 10분 스누즈'),
    Bd('- 완료 시에만 보상 — 거절·중단 페널티 없음'),
    GAP(),
    H('■ 완화 2종'),
    Bd('- 심호흡: 4-7-8 × 3회 ≈ 1분, 숨결 버블 팽창·수축 동기화'),
    Bd('- 명상: 90초 가이드(15초 6문장) + 진행 바'),
    GAP(),
    H('■ “아니요” 응답의 가치'),
    Bd('- 오탐 라벨로 축적 → 추후 감지 모델 개인화 보정에 활용'),
])

s = clear_content_slide(slides[35], '(Appendix) 3. 알람·방해금지 정책')
add_text(s, 0.9, 1.05, 5.9, 5.9, [
    H('■ 알람 4종 공통'),
    Bd('- 30초 주기 점검, 화면에 동시 1건(복약 > 물 > 스트레칭 > 휴식)'),
    Bd('- 응답: 확인(보상) / 나중에(10분 스누즈) / 무응답 45초 자동 닫힘'),
    Bd('- 미이행 게이지 벌점 없음 — 복약만 놓침 횟수 기록(순응률)'),
    GAP(),
    H('■ 켜고 끄기 정책'),
    Bd('- 약: 사용자가 등록·삭제하는 스케줄 기반'),
    Bd('- 물: 목표 컵·간격 조절(최소 20분)'),
    Rd('- 스트레칭·휴식: 끌 수 없음(건강 펫의 기본) — 간격만 조절'),
])
add_text(s, 7.1, 1.05, 5.3, 5.9, [
    H('■ 방해금지'),
    Bd('- 시간제: 설정에서 “사용” 토글 → 시작/끝 (기본 22~08시)'),
    Bd('- 수동: 우클릭·트레이 토글 — 시간제와 독립'),
    Bd('- 중: 알람·개입 중단, 펫 수면(투명 40%), 기력 +4/분'),
    GAP(),
    H('■ 클릭통과'),
    Bd('- 알람·프롬프트 노출 중에만 클릭 수신'),
    Bd('- 무응답 자동 닫힘의 1차 목적 = 바탕화면 클릭 먹통 방지'),
])

s = clear_content_slide(slides[36], '(Appendix) 4. 약지도 LUI 사전·등록 규칙')
add_text(s, 0.9, 1.05, 5.9, 5.9, [
    H('■ 시간 어휘 사전'),
    Bd('- 아침 09:00 / 점심 13:00 / 저녁 19:00 (직장인 점심 기준)'),
    Bd('- 자기 전·취침·밤 22:00 / 공복·기상 07:00'),
    Bd('- “N시”, “N시 반”, “HH:MM” 직접 표기 지원, 복수 시간 동시 인식'),
    GAP(),
    H('■ 명령 감지'),
    Bd('- 등록/추가/알람 맞춰/챙겨줘 포함 시 한 줄 등록 시도'),
    Bd('- 시간·명령 토큰을 제거한 나머지 = 약 이름'),
    Bd('- 시간 미인식 시 예시와 함께 재질문(위저드로 폴백)'),
])
add_text(s, 7.1, 1.05, 5.3, 5.9, [
    H('■ 등록 결과'),
    Bd('- 기본 매일 반복, 영양제 취급, 타이밍(식후 등) 자동 부여'),
    Bd('- 오버레이 알람·오늘의 복약·설정 관리 목록에 동시 반영'),
    GAP(),
    H('■ LUI vs GUI 병행 이유'),
    Bd('- 첫 등록은 대화가 이끌어 학습 비용↓, 반복 등록은 폼이 빠름'),
    Bd('- 두 경로 소요시간 자동 계측 내장(비교 테스트 설계서 별도)'),
    GAP(),
    H('■ LLM 교체 지점'),
    Bd('- core/medLui.ts(파서) → tool-calling 치환 시 자연어 전반 커버'),
])

s = clear_content_slide(slides[72], '(Appendix) 5. 페르소나·안전·프라이버시')
add_text(s, 0.9, 1.05, 5.9, 5.9, [
    H('■ 페르소나 — 상호 돌봄형 (규칙서 9/23 채택안)'),
    Bd('- 정체성: 내가 키우니, 나를 되돌아 챙겨주는 아이'),
    Bd('- 말투: 다정한 존댓말, 호칭 “집사님” (전 화면 통일)'),
    Bd('- 원칙: 판단·조언보다 경청 / 타이핑 속도·오타 언급 금지'),
    Bd('- 오버레이 말풍선·미니홈 챗·알람이 모두 같은 목소리'),
    GAP(),
    H('■ 안전 레이어 (안전 > 페르소나)'),
    Bd('- 위기 표현 감지 시 톤 전환 + 전문기관 즉시 안내'),
    Bd('   자살예방상담 109(24시간) · 정신건강 위기상담 1577-0199'),
    Bd('- 비의료 고지 상시: 진단·치료·약 조언 금지'),
])
add_text(s, 7.1, 1.05, 5.3, 5.9, [
    H('■ 프라이버시 (고정 원칙)'),
    Rd('- 키보드·마우스 “내용” 미수집 — 리듬·횟수만'),
    Bd('- 기분·일기·복약 기록 전부 기기 로컬, 서버·계정 없음'),
    Bd('- 공략집 첫 화면에 감지 방식·미수집 원칙 명시'),
    GAP(),
    H('■ 회원번호 (CP-XXXXXXXX)'),
    Bd('- 최초 실행 시 기기에서 자동 발급되는 익명 고유번호'),
    Bd('- 용도: 파일럿 데이터 조인 키(person_id) — 타이핑 마커·'),
    Bd('   ESM 라벨·복약 기록을 한 사람 단위로 묶는 기준'),
    Bd('- 이름·연락처와 연결하지 않음(화면에 고지)'),
])

s = clear_content_slide(slides[73], '(Appendix) 6. 데이터·기술 구조')
add_text(s, 0.9, 1.05, 5.9, 5.9, [
    H('■ 프로세스 구조 (Electron)'),
    Bd('- main: 창 2종·트레이·네이티브 메뉴·OS 알림·스트레스 매니저'),
    Bd('- preload: contextBridge로 petApi/careApi만 노출'),
    Bd('- renderer: 오버레이(App) / 미니홈(ChatApp) 2개 엔트리'),
    GAP(),
    H('■ 코어 로직 (순수함수 모듈)'),
    Bd('- progression(레벨·환생) / care(돌봄) / intake(알람·기록)'),
    Bd('- stress(감지 산식) / empathy(공감) / medLui(등록 파서)'),
    Bd('- drugData(약 설명) — UI와 분리, Vitest 테스트'),
])
add_text(s, 7.1, 1.05, 5.3, 5.9, [
    H('■ 저장소'),
    Bd('- electron-store(care-pong): pet·config(회원번호 포함)·intake'),
    Bd('- 미니홈 localStorage: 마음 일기(carepong-diary)'),
    GAP(),
    H('■ LLM 교체 지점 4곳 (현재 규칙 기반)'),
    Bd('- 공감 응답 / 약 설명 / 등록 파서 / 일기 요약(summarizeDay)'),
    GAP(),
    H('■ 이후 로드맵'),
    Bd('- LLM 실연동, 전역 키보드 마커(macOS 권한), 감지 개인화'),
    Bd('- 캐릭터 아트 확정, 수치 플레이 테스트, 패키징(.dmg)'),
])

# ══ 제이에스티나 브랜딩 제거 (로고 이미지 + © 푸터) ══
for layout in prs.slide_masters[0].slide_layouts:
    for sh in list(layout.shapes):
        try:
            is_pic = sh.shape_type == 13
        except Exception:
            is_pic = False
        txt = sh.text_frame.text if sh.has_text_frame else ''
        if is_pic or 'ESTINA' in txt.upper():
            sh._element.getparent().remove(sh._element)

# ══ 레이아웃 상단 바 Project 명 ══
for layout in prs.slide_masters[0].slide_layouts:
    for sh in layout.shapes:
        if sh.has_table:
            for row in sh.table.rows:
                cells = list(row.cells)
                for i, cell in enumerate(cells):
                    if cell.text.strip() == 'Project 명' and i + 1 < len(cells):
                        rr = [r for p in cells[i + 1].text_frame.paragraphs for r in p.runs]
                        if rr:
                            rr[0].text = '케어퐁'
                            for e in rr[1:]:
                                e.text = ''

# ══ 정리·재배열 ══
KEEP_ORDER = [0, 1, 2, 3, 4, 5, 6, 7,
              9, 10, 11, 12, 14, 16, 18, 19, 20, 22, 27,
              43, 44, 45, 46, 25, 26, 28, 29, 30, 31,
              33, 34, 35, 36, 72, 73, 81]
sldIdLst = prs.slides._sldIdLst
ids = list(sldIdLst)
keep = set(KEEP_ORDER)
for idx, sldId in enumerate(ids):
    if idx not in keep:
        prs.part.drop_rel(sldId.rId)
        sldIdLst.remove(sldId)
for idx in KEEP_ORDER:
    sldIdLst.remove(ids[idx])
    sldIdLst.append(ids[idx])

prs.save(OUT)
print('saved:', OUT, '| slides:', len(Presentation(OUT).slides))
