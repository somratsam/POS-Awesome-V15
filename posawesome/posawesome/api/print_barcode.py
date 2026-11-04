"""Code 128 barcode as inline SVG, for print formats (Jinja method).

Used by the Swan Sales Invoice receipt to print the invoice number, so the
Returns screen can load the original invoice from a scan. Drawn server-side
as plain SVG rectangles: it works the same in the browser print view, the
PDF (wkhtmltopdf) and QZ Tray, with no JavaScript and no extra package.

    {{ code128_svg(invoice_scan_code(doc.name)) }}

Only the number part of the name is encoded ("2026-00210" for
ACC-SINV-2026-00210): 165 modules instead of 264, which an Epson TM-T88V
(180 dpi, receipts scaled to 72 mm) still prints wide enough to scan. The
Returns screen finds the invoice from it (name LIKE %value%).
"""

# Bar/space widths (in modules) for Code 128 values 0-106; 106 is STOP.
_PATTERNS = (
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
    "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
    "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
    "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
    "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
    "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
    "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
    "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
    "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
    "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
    "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
    "211214", "211232", "2331112",
)
_START_B = 104
_STOP = 106
_QUIET_MODULES = 10


def invoice_scan_code(name):
    """Invoice name from its first all-digit group on ("ACC-SINV-2026-00210"
    -> "2026-00210", amended "...-00210-1" -> "2026-00210-1"); the whole
    name when no group is numeric."""
    groups = str(name or "").split("-")
    for index, group in enumerate(groups):
        if group.isdigit():
            return "-".join(groups[index:])
    return str(name or "")


def code128_values(value):
    """Code set B symbol values for value, with start, checksum and stop."""
    text = str(value or "")
    if not text or any(ord(ch) < 32 or ord(ch) > 126 for ch in text):
        return []
    data = [ord(ch) - 32 for ch in text]
    checksum = (_START_B + sum(pos * val for pos, val in enumerate(data, start=1))) % 103
    return [_START_B, *data, checksum, _STOP]


def code128_svg(value, width_mm=64, height_mm=14):
    """Inline SVG of value as a Code 128 barcode; "" when value can't be
    encoded (empty, or characters outside printable ASCII)."""
    values = code128_values(value)
    if not values:
        return ""

    rects = []
    x = _QUIET_MODULES
    for symbol in values:
        is_bar = True
        for width in _PATTERNS[symbol]:
            width = int(width)
            if is_bar:
                rects.append(f'<rect x="{x}" y="0" width="{width}" height="1"/>')
            x += width
            is_bar = not is_bar
    total = x + _QUIET_MODULES

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" class="barcode-img" '
        f'width="{float(width_mm)}mm" height="{float(height_mm)}mm" '
        f'viewBox="0 0 {total} 1" preserveAspectRatio="none" shape-rendering="crispEdges">'
        f'<rect x="0" y="0" width="{total}" height="1" fill="#fff"/>'
        f'<g fill="#000">{"".join(rects)}</g></svg>'
    )
