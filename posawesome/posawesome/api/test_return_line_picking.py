import unittest

import frappe

from posawesome.posawesome.api.invoice_processing.creation import _drop_unpicked_return_lines


def _doc(is_return=1, qtys=(-1, 0, -2)):
    """An unsaved Sales Invoice -- enough for the line check, no database."""
    return frappe.get_doc(
        {
            "doctype": "Sales Invoice",
            "is_return": is_return,
            "items": [{"item_code": f"IT-{i}", "qty": q, "rate": 10} for i, q in enumerate(qtys)],
        }
    )


class TestDropUnpickedReturnLines(unittest.TestCase):
    """Tick-to-return: return lines left at 0 weren't picked."""

    def test_zero_lines_are_dropped_and_renumbered(self):
        doc = _doc(qtys=(-1, 0, -2, 0))
        _drop_unpicked_return_lines(doc)
        self.assertEqual([(row.item_code, row.qty, row.idx) for row in doc.items], [("IT-0", -1, 1), ("IT-2", -2, 2)])

    def test_a_return_with_nothing_picked_is_refused(self):
        with self.assertRaises(frappe.ValidationError) as ctx:
            _drop_unpicked_return_lines(_doc(qtys=(0, 0)))
        self.assertIn("Select at least one item to return", str(ctx.exception))

    def test_a_return_with_no_lines_is_left_to_erpnext(self):
        # ERPNext refuses it itself ("At least one item should be entered...").
        doc = _doc(qtys=())
        _drop_unpicked_return_lines(doc)
        self.assertEqual(doc.items, [])

    def test_sales_are_untouched(self):
        doc = _doc(is_return=0, qtys=(1, 0))
        _drop_unpicked_return_lines(doc)
        self.assertEqual(len(doc.items), 2)

    def test_all_picked_is_unchanged(self):
        doc = _doc(qtys=(-1, -3))
        _drop_unpicked_return_lines(doc)
        self.assertEqual([row.qty for row in doc.items], [-1, -3])


if __name__ == "__main__":
    unittest.main()
