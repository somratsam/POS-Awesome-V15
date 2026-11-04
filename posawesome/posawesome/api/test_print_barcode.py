import pathlib
import importlib.util
import unittest

_PATH = pathlib.Path(__file__).resolve().parent / "print_barcode.py"
_spec = importlib.util.spec_from_file_location("posa_print_barcode_under_test", _PATH)
print_barcode = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(print_barcode)

# Module pattern of "ACC-SINV-2026-00206" from jsbarcode's CODE128B encoder
# (frontend dependency), which a zxing decode also read back correctly.
EXPECTED_BITS = "1101001000010100011000100010001101000100011010011011100110111010001100010001010111000110111010110001001101110011001110010100111011001100111001011001110100100110111001001110110010011101100110011100101001110110011001110100110010000101100011101011"


def _bits(value):
    out = ""
    for symbol in print_barcode.code128_values(value):
        is_bar = True
        for width in print_barcode._PATTERNS[symbol]:
            out += ("1" if is_bar else "0") * int(width)
            is_bar = not is_bar
    return out


class TestCode128(unittest.TestCase):
    def test_invoice_number_matches_reference_encoder(self):
        self.assertEqual(_bits("ACC-SINV-2026-00206"), EXPECTED_BITS)

    def test_svg_has_one_rect_per_bar(self):
        svg = print_barcode.code128_svg("ACC-SINV-2026-00206")
        self.assertTrue(svg.startswith("<svg"))
        bars = EXPECTED_BITS.replace("0", " ").split()
        self.assertEqual(svg.count("<rect"), len(bars) + 1)  # + white background

    def test_unencodable_values_print_nothing(self):
        self.assertEqual(print_barcode.code128_svg(""), "")
        self.assertEqual(print_barcode.code128_svg(None), "")
        self.assertEqual(print_barcode.code128_svg("فاتورة"), "")

    def test_scan_code_is_the_number_part_of_the_name(self):
        self.assertEqual(print_barcode.invoice_scan_code("ACC-SINV-2026-00210"), "2026-00210")
        self.assertEqual(print_barcode.invoice_scan_code("ACC-SINV-2026-00210-1"), "2026-00210-1")
        self.assertEqual(print_barcode.invoice_scan_code("NO-DIGITS"), "NO-DIGITS")
