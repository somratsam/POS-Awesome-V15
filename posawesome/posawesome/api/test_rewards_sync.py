import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.api import rewards_sync


class TestGenerateReceiptPdfBaseUrl(unittest.TestCase):
	"""Regression guard for a real production bug: wkhtmltopdf runs as a
	separate OS subprocess and has no reason to be able to resolve a site's
	configured name (e.g. site1.local) via DNS, even though the Frappe app
	itself is reachable under that name. Using frappe.local.site in the
	base_url worked on staging only because staging.local happens to be in
	that machine's /etc/hosts -- on production it failed every time with
	wkhtmltopdf's "HostNotFoundError". The base_url must use the loopback
	IP, which needs no resolution at all.
	"""

	def test_base_url_uses_loopback_not_site_name(self):
		captured = {}

		def fake_set_request(method, path, base_url):
			captured["base_url"] = base_url

		original_request = getattr(frappe.local, "request", None)
		original_site = frappe.local.site
		original_port = frappe.local.conf.webserver_port

		frappe.local.request = None
		frappe.local.site = "site1.local"
		frappe.local.conf.webserver_port = 8000

		try:
			with (
				patch("frappe.utils.set_request", side_effect=fake_set_request),
				patch("frappe.utils.pdf.get_pdf", return_value=b"%PDF-fake"),
				patch("frappe.get_print", return_value="<html></html>"),
				patch.object(rewards_sync, "_strip_blank_trailing_pages", side_effect=lambda b: b),
			):
				rewards_sync._generate_receipt_pdf("SINV-0001")
		finally:
			frappe.local.request = original_request
			frappe.local.site = original_site
			frappe.local.conf.webserver_port = original_port

		self.assertIn("base_url", captured)
		self.assertNotIn("site1.local", captured["base_url"])
		self.assertTrue(
			captured["base_url"].startswith("http://127.0.0.1:"),
			f"expected loopback base_url, got {captured['base_url']!r}",
		)
