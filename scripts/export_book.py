"""Export the versioned Arabic manuscript with Python's standard library.

EPUB packaging follows https://www.w3.org/TR/epub-33/. No remote service,
browser engine, or package installation is required. Input prose is plain text.
"""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile


INITIAL_PUBLICATION_DATE = "2026-11-02T00:00:00Z"
STATUS_LABELS = {
    "outline": "مخطط فصل — النص لم يُكتب بعد",
    "draft": "مسودة فصل — قيد المراجعة",
    "review": "مسودة فصل — قيد المراجعة",
    "published": "نص الفصل",
}
NS = {
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
    "xhtml": "http://www.w3.org/1999/xhtml",
    "container": "urn:oasis:names:tc:opendocument:xmlns:container",
}
EPUB_TYPE = "{http://www.idpf.org/2007/ops}type"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
BASE_CSS = """
html { direction: rtl; }
body { direction: rtl; font-family: 'Basira Amiri', 'Amiri', 'Noto Naskh Arabic', 'Traditional Arabic', serif; font-size: 1.2em; line-height: 1.9; margin: 5%; color: #28251f; background: #fff; }
h1, h2, h3 { line-height: 1.55; font-weight: 700; break-after: avoid; }
h1 { font-size: 2.2em; }
h2 { font-size: 1.6em; }
h3 { font-size: 1.15em; }
p { orphans: 3; widows: 3; }
a { color: #775735; text-decoration-thickness: 1px; }
ul, ol { padding-inline-start: 1.5em; }
li { margin-block: .55em; }
.series, .part-title, .status, .edition-note, .print-tools { font-family: 'Basira Sans', 'Noto Sans Arabic', sans-serif; font-size: .78em; line-height: 1.9; }
.series { letter-spacing: .03em; color: #775735; }
.status { border-inline-start: 3px solid #bca47c; padding-inline-start: 1em; color: #685b49; }
.summary { font-weight: 700; }
.title-page { text-align: center; padding-block: 2em; }
.title-page img { max-width: 75%; max-height: 65vh; object-fit: contain; display: block; margin: 0 auto 1.5em; }
.chapter, .part { break-before: page; page-break-before: always; }
.part-title { color: #775735; }
.edition-note { color: #625b51; }
nav ol { list-style: none; padding-inline-start: 0; }
nav ol ol { padding-inline-start: 1.2em; }
"""


def escaped(value: str) -> str:
    return html.escape(value, quote=True)


def paragraphs(values: list[str]) -> str:
    return "\n".join(f"<p>{escaped(value).replace(chr(10), '<br />')}</p>" for value in values)


def markdown_text(value: str) -> str:
    return re.sub(r"([\\`*_{}\[\]<>])", r"\\\1", value)


def modified_date(data: dict) -> datetime:
    if "SOURCE_DATE_EPOCH" in os.environ:
        return datetime.fromtimestamp(int(os.environ["SOURCE_DATE_EPOCH"]), timezone.utc).replace(microsecond=0)
    value = data["series"].get("updatedAt", INITIAL_PUBLICATION_DATE)
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def load_assets(directory: Path) -> dict[str, bytes]:
    assets = {}
    cover = directory / "alkatib-cover.png"
    if cover.is_file():
        assets["images/cover.png"] = cover.read_bytes()
    fonts = directory / "fonts"
    if fonts.is_dir():
        candidates = sorted(item for item in fonts.iterdir() if item.suffix.lower() in {".woff2", ".woff", ".ttf"})
        for stem, target in (("amiri", "fonts/amiri"), ("notosansarabic", "fonts/noto-sans-arabic")):
            matching = [item for item in candidates if stem in re.sub(r"[^a-z]", "", item.stem.lower())]
            if matching:
                preferred = next((item for item in matching if "regular" in item.stem.lower()), next((item for item in matching if "bold" not in item.stem.lower()), matching[0]))
                assets[target + preferred.suffix.lower()] = preferred.read_bytes()
        bold = next((item for item in candidates if "amiri" in item.stem.lower() and "bold" in item.stem.lower()), None)
        if bold:
            assets["fonts/amiri-bold" + bold.suffix.lower()] = bold.read_bytes()
    return assets


def stylesheet(assets: dict[str, bytes], standalone: bool = False) -> str:
    faces = []
    for file in assets:
        if not file.startswith("fonts/"):
            continue
        family = "Basira Amiri" if "amiri" in file else "Basira Sans"
        weight = "700" if "bold" in file else "400"
        extension = file.rsplit(".", 1)[1]
        format_name = "truetype" if extension == "ttf" else extension
        source = f"data:font/{extension};base64,{base64.b64encode(assets[file]).decode('ascii')}" if standalone else file
        faces.append(f"@font-face {{ font-family: '{family}'; src: url('{source}') format('{format_name}'); font-style: normal; font-weight: {weight}; }}")
    return "\n".join(faces) + BASE_CSS


def font_licenses(directory: Path, assets: dict[str, bytes]) -> str:
    texts = []
    for prefix, file in (("fonts/amiri", "Amiri-OFL.txt"), ("fonts/noto-sans-arabic", "NotoSansArabic-OFL.txt")):
        if any(name.startswith(prefix) for name in assets):
            path = directory / "fonts" / file
            if not path.is_file():
                raise ValueError(f"Font embedding requires its license file: {path}")
            texts.append(f'<h2 dir="ltr">{escaped(file)}</h2><pre dir="ltr" lang="en" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.75em;line-height:1.5">{escaped(path.read_text(encoding="utf-8-sig"))}</pre>')
    return '<section id="font-licenses"><h1>تراخيص الخطوط</h1>' + "".join(texts) + "</section>" if texts else ""


def xhtml(title: str, body: str) -> str:
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ar" xml:lang="ar" dir="rtl">
<head><meta charset="utf-8" /><title>{escaped(title)}</title><link rel="stylesheet" type="text/css" href="styles.css" /></head>
<body>{body}</body>
</html>
'''


def chapter_body(chapter: dict, part: dict) -> str:
    number = chapter["number"]
    text = f'''<section class="chapter" id="{chapter['id']}">
<p class="part-title">{escaped(part['title'])}</p>
<h1>الفصل {number}: {escaped(chapter['title'])}</h1>
<p class="status">{STATUS_LABELS[chapter['status']]}</p>
'''
    if chapter["paragraphs"]:
        text += paragraphs(chapter["paragraphs"])
    else:
        text += f"<p class=\"summary\">{escaped(chapter['summary'])}</p>\n<h2>محاور الفصل المقترحة</h2>\n<ul>"
        text += "\n".join(f"<li>{escaped(item)}</li>" for item in chapter["outline"])
        text += "</ul>\n<p class=\"edition-note\">هذه محاور تحريرية لجمع مادة الفصل؛ سيُضاف السرد بعد كتابة التجارب ومراجعتها.</p>"
    return text + "\n</section>"


def title_body(data: dict, book: dict, assets: dict[str, bytes], standalone: bool = False) -> str:
    cover = ""
    if "images/cover.png" in assets:
        source = "data:image/png;base64," + base64.b64encode(assets["images/cover.png"]).decode("ascii") if standalone else "images/cover.png"
        cover = f'<img src="{source}" alt="غلاف كتاب {escaped(book["title"])} من سلسلة {escaped(data["series"]["title"])}" />'
    author = data["series"].get("author")
    author_line = f"<p>{escaped(author)}</p>" if author else ""
    return f'''<section class="title-page" id="title-page">
{cover}<p class="series">سلسلة {escaped(data['series']['title'])} · الكتاب الأول</p>
<h1>{escaped(book['title'])}</h1><p>{escaped(book['subtitle'])}</p>{author_line}
<p class="edition-note">نسخة عمل قيد الكتابة — تتضمن النصوص المتاحة ومخططات الفصول التي لم تُكتب بعد.</p>
</section>'''


def intro_body(data: dict) -> str:
    intro = data["introduction"]
    return f'<section id="introduction"><h1>{escaped(intro["title"])}</h1>{paragraphs(intro["paragraphs"])}</section>'


def toc_body(data: dict, book: dict, standalone: bool = False) -> str:
    intro_link = "#introduction" if standalone else "intro.xhtml"
    items = [f'<li><a href="{intro_link}">{escaped(data["introduction"]["title"])}</a></li>']
    for part in book["parts"]:
        children = []
        for chapter in book["chapters"]:
            if chapter["partId"] != part["id"]:
                continue
            destination = f"#{chapter['id']}" if standalone else f"{chapter['id']}.xhtml"
            children.append(f'<li><a href="{destination}">{chapter["number"]}. {escaped(chapter["title"])}</a></li>')
        items.append(f'<li><span>{escaped(part["title"])}</span><ol>{"".join(children)}</ol></li>')
    attribute = 'aria-label="فهرس الكتاب"' if standalone else 'epub:type="toc" id="toc"'
    return f'<nav {attribute}><h1>فهرس الكتاب</h1><ol>{"".join(items)}</ol></nav>'


def render_markdown(data: dict, book: dict) -> str:
    lines = [f"# {markdown_text(book['title'])}", f"سلسلة {markdown_text(data['series']['title'])} — الكتاب الأول", book["subtitle"], ""]
    if data["series"].get("author"):
        lines.extend([markdown_text(data["series"]["author"]), ""])
    lines.extend(["> نسخة عمل قيد الكتابة. الفصول التي لم تُكتب بعد معروضة كمخططات تحريرية.", "", f"## {markdown_text(data['introduction']['title'])}", ""])
    lines.extend(markdown_text(value) + "\n" for value in data["introduction"]["paragraphs"])
    for part in book["parts"]:
        lines.extend([f"## {markdown_text(part['title'])}", ""])
        for chapter in book["chapters"]:
            if chapter["partId"] != part["id"]:
                continue
            lines.extend([f"### الفصل {chapter['number']}: {markdown_text(chapter['title'])}", "", f"> {STATUS_LABELS[chapter['status']]}", ""])
            if chapter["paragraphs"]:
                lines.extend(markdown_text(value) + "\n" for value in chapter["paragraphs"])
            else:
                lines.extend([markdown_text(chapter["summary"]), "", "محاور الفصل المقترحة:", ""])
                lines.extend(f"- {markdown_text(value)}" for value in chapter["outline"])
                lines.extend(["", "هذه محاور تحريرية لجمع مادة الفصل؛ سيُضاف السرد بعد كتابة التجارب ومراجعتها.", ""])
    return "\n".join(lines).rstrip() + "\n"


def render_print_html(data: dict, book: dict, assets: dict[str, bytes], licenses: str = "") -> str:
    parts = {part["id"]: part for part in book["parts"]}
    content = title_body(data, book, assets, standalone=True) + intro_body(data) + toc_body(data, book, standalone=True)
    content += "\n".join(chapter_body(chapter, parts[chapter["partId"]]) for chapter in book["chapters"])
    if licenses:
        content += '<details class="font-licenses"><summary>تراخيص الخطوط المضمّنة</summary>' + licenses + '</details>'
    print_css = """
body { margin: 0; background: #f4f0e8; font-size: 22px; }
main { box-sizing: border-box; max-width: 850px; margin: 2rem auto; padding: 4rem 4.5rem; background: #fff; }
.print-tools { max-width: 850px; padding: 1rem; margin: auto; box-sizing: border-box; }
.print-tools button { cursor: pointer; font: inherit; padding: .65rem 1.25rem; border: 1px solid #775735; border-radius: .25rem; background: #775735; color: white; }
.print-tools p { margin-block: .5rem; }
.chapter { margin-block-start: 4rem; padding-block-start: 2rem; border-block-start: 1px solid #ded4c6; }
@media(max-width: 600px) { main { padding: 1.5rem; margin: 0; } body { font-size: 19px; } }
@page { size: A4; margin: 22mm 20mm; }
@media print {
  body { background: white; color: black; font-size: 15pt; }
  main { max-width: none; margin: 0; padding: 0; }
  .print-tools, .font-licenses { display: none; }
  .title-page, nav { break-after: page; page-break-after: always; }
  .chapter { margin: 0; padding: 0; border: 0; }
  .title-page img { max-height: 180mm; }
  a { color: inherit; text-decoration: none; }
}
"""
    return f'''<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escaped(book['title'])} — نسخة للطباعة</title><style>{stylesheet(assets, standalone=True)}{print_css}</style></head>
<body><aside class="print-tools"><button type="button" onclick="window.print()">طباعة / حفظ PDF</button><p>يمكن قراءة هذه النسخة دون اتصال. لحفظ PDF اختر «حفظ كملف PDF» من نافذة الطباعة.</p></aside>
<main>{content}</main></body></html>
'''


def package_xml(data: dict, book: dict, modified: str, assets: dict[str, bytes], has_licenses: bool = False) -> str:
    publication_id = uuid.uuid5(uuid.NAMESPACE_URL, f"urn:basira:{book['id']}")
    author = data["series"].get("author")
    author_line = f'<dc:creator>{escaped(author)}</dc:creator>' if author else ""
    items = [
        '<item id="title" href="title.xhtml" media-type="application/xhtml+xml" />',
        '<item id="intro" href="intro.xhtml" media-type="application/xhtml+xml" />',
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
        '<item id="styles" href="styles.css" media-type="text/css" />',
    ]
    for chapter in book["chapters"]:
        items.append(f'<item id="{chapter["id"]}" href="{chapter["id"]}.xhtml" media-type="application/xhtml+xml" />')
    for index, name in enumerate(assets):
        media_type = "image/png" if name.endswith(".png") else "font/" + name.rsplit(".", 1)[1]
        properties = ' properties="cover-image"' if name == "images/cover.png" else ""
        items.append(f'<item id="asset-{index}" href="{name}" media-type="{media_type}"{properties} />')
    spine_ids = ["title", "intro", "nav", *[chapter["id"] for chapter in book["chapters"]]]
    spine = "".join(f'<itemref idref="{identifier}" />' for identifier in spine_ids)
    if has_licenses:
        items.append('<item id="font-licenses" href="licenses.xhtml" media-type="application/xhtml+xml" />')
        spine += '<itemref idref="font-licenses" linear="no" />'
    return f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="publication-id" xml:lang="ar" dir="rtl">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="publication-id">urn:uuid:{publication_id}</dc:identifier>
<dc:title>{escaped(book['title'])} — {escaped(data['series']['title'])}</dc:title>
<dc:language>ar</dc:language>{author_line}
<dc:description>{escaped(book['description'])} نسخة عمل قيد الكتابة؛ تميّز مخططات الفصول عن النصوص السردية.</dc:description>
<meta property="dcterms:modified">{modified}</meta>
</metadata><manifest>{''.join(items)}</manifest>
<spine page-progression-direction="rtl">{spine}</spine>
</package>
'''


def validate_epub(path: Path, chapter_ids: list[str]) -> None:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        assert entries[0].filename == "mimetype", "EPUB mimetype must be the first ZIP entry."
        assert entries[0].compress_type == zipfile.ZIP_STORED and not entries[0].extra, "EPUB mimetype must be stored without an extra header."
        assert archive.read("mimetype") == b"application/epub+zip", "Incorrect EPUB media type."
        assert archive.testzip() is None, "An EPUB archive entry failed its CRC check."
        names = set(archive.namelist())
        assert len(names) == len(entries), "Duplicate EPUB ZIP entries."
        for name in names:
            assert not name.startswith("/") and ".." not in PurePosixPath(name).parts, "Unsafe archive path."
            if name.endswith((".xml", ".opf", ".xhtml")):
                ET.fromstring(archive.read(name))
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        rootfile = container.find("container:rootfiles/container:rootfile", NS)
        assert rootfile is not None and rootfile.get("full-path") == "EPUB/package.opf", "Missing EPUB rootfile."
        package = ET.fromstring(archive.read("EPUB/package.opf"))
        assert package.findtext("opf:metadata/dc:language", namespaces=NS) == "ar", "EPUB language must be Arabic."
        manifest = package.find("opf:manifest", NS)
        assert manifest is not None
        resources = {item.get("id"): item.get("href") for item in manifest}
        assert len(resources) == len(list(manifest)), "Duplicate EPUB manifest ids."
        assert all(f"EPUB/{href}" in names for href in resources.values()), "An EPUB manifest resource is missing."
        spine = package.find("opf:spine", NS)
        assert spine is not None and spine.get("page-progression-direction") == "rtl", "EPUB spine must use RTL."
        refs = [item.get("idref") for item in spine]
        assert len(refs) == len(set(refs)) and all(ref in resources for ref in refs), "Invalid EPUB spine references."
        assert [ref for ref in refs if ref.startswith("chapter-")] == chapter_ids, "EPUB chapter reading order changed."
        nav = ET.fromstring(archive.read("EPUB/nav.xhtml"))
        toc = next((node for node in nav.iter() if node.get(EPUB_TYPE) == "toc"), None)
        assert toc is not None, "EPUB requires a navigation TOC."
        chapter_links = [node.get("href") for node in toc.iter(f"{{{NS['xhtml']}}}a") if node.get("href", "").startswith("chapter-")]
        assert chapter_links == [f"{identifier}.xhtml" for identifier in chapter_ids], "The EPUB TOC must include every chapter in order."
        for name in names:
            if not name.endswith(".xhtml"):
                continue
            document = ET.fromstring(archive.read(name))
            assert document.get("dir") == "rtl" and document.get(XML_LANG) == "ar", f"Missing Arabic direction/language in {name}."
            for node in document.iter():
                resource = node.get("href") or node.get("src")
                if not resource or resource.startswith(("http:", "https:", "data:", "#")):
                    continue
                destination = PurePosixPath(name).parent / resource.split("#", 1)[0]
                assert str(destination) in names, f"Broken EPUB resource link: {name} -> {resource}."


def write_epub(path: Path, data: dict, book: dict, date: datetime, assets: dict[str, bytes], licenses: str = "") -> None:
    parts = {part["id"]: part for part in book["parts"]}
    files = {
        "mimetype": b"application/epub+zip",
        "META-INF/container.xml": b'<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
        "EPUB/package.opf": package_xml(data, book, date.strftime("%Y-%m-%dT%H:%M:%SZ"), assets, has_licenses=bool(licenses)),
        "EPUB/styles.css": stylesheet(assets),
        "EPUB/title.xhtml": xhtml(book["title"], title_body(data, book, assets)),
        "EPUB/intro.xhtml": xhtml(data["introduction"]["title"], intro_body(data)),
        "EPUB/nav.xhtml": xhtml("فهرس الكتاب", toc_body(data, book)),
    }
    if licenses:
        files["EPUB/licenses.xhtml"] = xhtml("تراخيص الخطوط", licenses)
        files["EPUB/title.xhtml"] = xhtml(book["title"], title_body(data, book, assets) + '<p><a href="licenses.xhtml">تراخيص الخطوط المضمّنة</a></p>')
    for chapter in book["chapters"]:
        files[f"EPUB/{chapter['id']}.xhtml"] = xhtml(chapter["title"], chapter_body(chapter, parts[chapter["partId"]]))
    files.update({f"EPUB/{name}": value for name, value in assets.items()})
    zip_year = max(1980, min(2107, date.year))
    zip_date = (zip_year, date.month, date.day, date.hour, date.minute, date.second)
    with zipfile.ZipFile(path, "w") as archive:
        for name, value in files.items():
            info = zipfile.ZipInfo(name, date_time=zip_date)
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, value.encode("utf-8") if isinstance(value, str) else value)
    validate_epub(path, [chapter["id"] for chapter in book["chapters"]])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.source.read_text(encoding="utf-8-sig"))
    book = next(book for book in data["books"] if book["id"] == "alkatib")
    assert len(book["chapters"]) == 20 and len(book["parts"]) == 5, "Alkatib must contain five parts and twenty chapters."
    for chapter in book["chapters"]:
        assert chapter["status"] in STATUS_LABELS, "Unsupported chapter status."
        assert (chapter["status"] == "outline") == (len(chapter["paragraphs"]) == 0), "Chapter status does not match manuscript content."
    assets = load_assets(args.assets)
    licenses = font_licenses(args.assets, assets)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "alkatib.md").write_text(render_markdown(data, book), encoding="utf-8", newline="\n")
    (args.output / "alkatib.html").write_text(render_print_html(data, book, assets, licenses), encoding="utf-8", newline="\n")
    epub_path = args.output / "alkatib.epub"
    write_epub(epub_path, data, book, modified_date(data), assets, licenses)
    for name in ("alkatib.epub", "alkatib.md", "alkatib.html"):
        path = args.output / name
        print(f"Exported {name}: {path.stat().st_size} bytes; SHA256 {hashlib.sha256(path.read_bytes()).hexdigest()[:16]}")
    print("EPUB archive, XML, navigation, resource links, 20-chapter order and RTL validation passed.")


if __name__ == "__main__":
    main()
