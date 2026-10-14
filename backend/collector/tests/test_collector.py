"""수집기 집계 — pynput 없이 on_* 직접 호출. 실행: cd collector && pytest"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from collector import Collector, FEATURES

def test_sixteen_features_and_ratios():
    c = Collector(60)
    for ch in "hello world": c.on_press(ch, is_space=(ch == " "), char=None if ch == " " else ch)
    c.on_press("bs", is_err=True)
    f = c.snapshot()["features"]
    assert list(f) == FEATURES and len(f) == 16
    assert f["SnKeyStrokes"] == 12 and f["SnChars"] == 10 and f["SnSpaces"] == 1
    assert f["CharactersRatio"] == round(10 / 12, 4) and f["ErrorKeyRatio"] == round(1 / 11, 4)

def test_shortcut_double_click_drag_distance():
    c = Collector(60)
    c.on_press("ctrl", is_mod=True); c.on_press("c", char="c"); c.on_release("ctrl")
    c.on_click(0, 0, "left", True); c.on_click(0, 0, "left", False)
    c.on_click(0, 0, "left", True); c.on_click(30, 0, "left", False)
    c.on_move(0, 0); c.on_move(3, 4)
    f = c.snapshot()["features"]
    assert f["SnShortcutKeys"] == 1 and f["SnDoubleClicked"] == 1 and f["SnDragged"] == 1 and f["SnMouseDistance"] == 5.0

def test_snapshot_resets_counters():
    c = Collector(60); c.on_press("a", char="a"); c.snapshot()
    assert c.snapshot()["features"]["SnKeyStrokes"] == 0
