"""Dark-themed PPTX generation service using python-pptx."""

from io import BytesIO

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

SLIDE_W = Inches(13.33)
SLIDE_H = Inches(7.5)

BG       = RGBColor(0x1A, 0x20, 0x28)
CARD     = RGBColor(0x23, 0x2B, 0x35)
AZURE    = RGBColor(0x00, 0x78, 0xD4)
ACCENT   = RGBColor(0x50, 0xC2, 0xFF)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT    = RGBColor(0xE0, 0xE8, 0xF0)
MUTED    = RGBColor(0x80, 0x98, 0xB0)
DIV_CLR  = RGBColor(0x2D, 0x3A, 0x47)


def _set_bg(slide, color: RGBColor):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def _rect(slide, left, top, width, height, color: RGBColor):
    shape = slide.shapes.add_shape(1, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    return shape


def _text(slide, text: str, left, top, width, height, size: int,
          bold=False, italic=False, color=WHITE, align=PP_ALIGN.LEFT):
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    run.font.name = "Segoe UI"
    return tb


def _bullets(slide, items: list[str], left, top, width, height,
             size: int = 19, text_color=LIGHT):
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_before = Pt(5)
        run = p.add_run()
        run.text = f"\u25aa  {item}"
        run.font.size = Pt(size)
        run.font.color.rgb = text_color
        run.font.name = "Segoe UI"
    return tb


def _notes(slide, text: str):
    slide.notes_slide.notes_text_frame.text = text


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


# ── Layout renderers ─────────────────────────────────────────────────────────

def _title_slide(prs, s: dict):
    slide = _blank(prs)
    _set_bg(slide, BG)
    _rect(slide, Inches(0), Inches(0), Inches(0.09), SLIDE_H, AZURE)
    _rect(slide, Inches(0), Inches(6.85), SLIDE_W, Inches(0.65), AZURE)
    _text(slide, s.get("title", ""), Inches(0.5), Inches(1.6), Inches(9.5), Inches(2.2),
          size=48, bold=True)
    content = s.get("content") or []
    subtitle = content[0] if content else ""
    _text(slide, subtitle, Inches(0.5), Inches(3.95), Inches(9.5), Inches(1.6),
          size=24, color=ACCENT)
    for i in range(6):
        _rect(slide, Inches(10.8 + i * 0.42), Inches(2.2), Pt(7), Pt(7), AZURE)
    if s.get("speaker_notes"):
        _notes(slide, s["speaker_notes"])


def _agenda_slide(prs, s: dict):
    slide = _blank(prs)
    _set_bg(slide, BG)
    _rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.05), AZURE)
    _text(slide, s.get("title", "Agenda"), Inches(0.4), Inches(0.18),
          Inches(12), Inches(0.68), size=28, bold=True)
    items = s.get("content") or []
    row_h = Inches(0.72)
    gap   = Inches(0.07)
    for idx, item in enumerate(items[:7]):
        top = Inches(1.22) + idx * (row_h + gap)
        _rect(slide, Inches(0.4), top, Inches(12.5), row_h, CARD)
        _rect(slide, Inches(0.4), top, Inches(0.54), row_h, AZURE)
        _text(slide, str(idx + 1), Inches(0.4), top + Inches(0.1),
              Inches(0.54), Inches(0.52), size=22, bold=True, align=PP_ALIGN.CENTER)
        _text(slide, item, Inches(1.1), top + Inches(0.12),
              Inches(11.3), Inches(0.52), size=19, color=LIGHT)
    if s.get("speaker_notes"):
        _notes(slide, s["speaker_notes"])


def _divider_slide(prs, s: dict):
    slide = _blank(prs)
    _set_bg(slide, AZURE)
    _text(slide, s.get("title", ""), Inches(1.0), Inches(2.3), Inches(11.3), Inches(2.6),
          size=44, bold=True, align=PP_ALIGN.CENTER)
    content = s.get("content") or []
    if content:
        _text(slide, content[0], Inches(1.5), Inches(5.1), Inches(10.3), Inches(1.3),
              size=20, color=RGBColor(0xC0, 0xE0, 0xFF), align=PP_ALIGN.CENTER)
    if s.get("speaker_notes"):
        _notes(slide, s["speaker_notes"])


def _content_slide(prs, s: dict):
    slide = _blank(prs)
    _set_bg(slide, BG)
    _rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.0), CARD)
    _rect(slide, Inches(0), Inches(0), Inches(0.09), Inches(1.0), AZURE)
    _text(slide, s.get("title", ""), Inches(0.35), Inches(0.15),
          Inches(12.5), Inches(0.7), size=28, bold=True)
    _bullets(slide, s.get("content") or [], Inches(0.5), Inches(1.1),
             Inches(12.3), Inches(6.0))
    if s.get("speaker_notes"):
        _notes(slide, s["speaker_notes"])


def _two_column_slide(prs, s: dict):
    slide = _blank(prs)
    _set_bg(slide, BG)
    _rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.0), CARD)
    _rect(slide, Inches(0), Inches(0), Inches(0.09), Inches(1.0), AZURE)
    _text(slide, s.get("title", ""), Inches(0.35), Inches(0.15),
          Inches(12.5), Inches(0.7), size=28, bold=True)
    _rect(slide, Inches(6.55), Inches(1.1), Inches(0.04), Inches(6.0), DIV_CLR)
    _bullets(slide, s.get("content") or [], Inches(0.4), Inches(1.15),
             Inches(5.9), Inches(5.85))
    _bullets(slide, s.get("right_content") or [], Inches(6.8), Inches(1.15),
             Inches(6.1), Inches(5.85))
    if s.get("speaker_notes"):
        _notes(slide, s["speaker_notes"])


def _quote_stat_slide(prs, s: dict):
    slide = _blank(prs)
    _set_bg(slide, BG)
    content = s.get("content") or []
    _rect(slide, Inches(0.5), Inches(1.4), Inches(0.13), Inches(4.6), AZURE)
    main = content[0] if content else s.get("title", "")
    label = s.get("title", "")
    sub   = content[1] if len(content) > 1 else ""
    _text(slide, main, Inches(0.85), Inches(1.5), Inches(11.5), Inches(3.0),
          size=52, bold=True, color=ACCENT)
    _text(slide, label, Inches(0.85), Inches(4.8), Inches(11.0), Inches(1.0),
          size=22, color=WHITE)
    if sub:
        _text(slide, sub, Inches(0.85), Inches(5.9), Inches(11.0), Inches(1.0),
              size=16, color=MUTED)
    if s.get("speaker_notes"):
        _notes(slide, s["speaker_notes"])


def _summary_slide(prs, s: dict):
    slide = _blank(prs)
    _set_bg(slide, BG)
    _rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.0), CARD)
    _rect(slide, Inches(0), Inches(0), Inches(0.09), Inches(1.0), AZURE)
    _text(slide, s.get("title", "Key Takeaways"), Inches(0.35), Inches(0.15),
          Inches(12.5), Inches(0.7), size=28, bold=True)
    items  = s.get("content") or []
    row_h  = Inches(0.88)
    gap    = Inches(0.09)
    for idx, item in enumerate(items[:5]):
        top = Inches(1.12) + idx * (row_h + gap)
        _rect(slide, Inches(0.4), top, Inches(12.5), row_h, CARD)
        _rect(slide, Inches(0.4), top, Inches(0.09), row_h, AZURE)
        _text(slide, item, Inches(0.65), top + Inches(0.14),
              Inches(12.0), Inches(0.65), size=18, color=LIGHT)
    if s.get("speaker_notes"):
        _notes(slide, s["speaker_notes"])


def _references_slide(prs, s: dict):
    slide = _blank(prs)
    _set_bg(slide, BG)
    _rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.05), AZURE)
    _text(slide, s.get("title", "References & Resources"), Inches(0.4), Inches(0.18),
          Inches(12), Inches(0.68), size=28, bold=True)
    _bullets(slide, s.get("content") or [], Inches(0.5), Inches(1.2),
             Inches(12.3), Inches(5.9), size=17, text_color=LIGHT)
    if s.get("speaker_notes"):
        _notes(slide, s["speaker_notes"])


_HANDLERS = {
    "title":           _title_slide,
    "agenda":          _agenda_slide,
    "section_divider": _divider_slide,
    "content":         _content_slide,
    "two_column":      _two_column_slide,
    "quote_stat":      _quote_stat_slide,
    "summary":         _summary_slide,
    "references":      _references_slide,
}


def build_presentation(outline: dict) -> bytes:
    prs = Presentation()
    prs.slide_width  = SLIDE_W
    prs.slide_height = SLIDE_H
    for slide_data in outline.get("slides", []):
        handler = _HANDLERS.get(slide_data.get("layout", "content"), _content_slide)
        handler(prs, slide_data)
    buf = BytesIO()
    prs.save(buf)
    return buf.getvalue()
