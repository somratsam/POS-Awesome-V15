import os
import tempfile
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


class TestInlineStylesheetLinks(unittest.TestCase):
	"""Regression guard for a second, distinct production bug that surfaced
	after the base_url fix above: Frappe's printview wrapper always links
	its own print.bundle.css, and wkhtmltopdf fetches that <link> as a real
	self-referencing HTTP request -- one that intermittently failed under
	real batch load (ContentNotFoundError / RemoteHostClosedError), even
	though the receipt's own inline <style> block doesn't need it.
	wkhtmltopdf's load-error-handling/load-media-error-handling options do
	NOT cover a failed stylesheet <link> fetch -- confirmed empirically
	before this fix (15/15 failures either way). Reading the file directly
	off disk removes the network fetch as a failure mode entirely.
	"""

	def setUp(self):
		self.tmpdir = tempfile.mkdtemp()
		self.original_sites_path = frappe.local.sites_path
		frappe.local.sites_path = self.tmpdir
		asset_dir = os.path.join(self.tmpdir, "assets", "frappe", "dist", "css")
		os.makedirs(asset_dir)
		with open(os.path.join(asset_dir, "print.bundle.ABC123.css"), "w") as f:
			f.write(".print-format-gutter { background: red; }")

	def tearDown(self):
		frappe.local.sites_path = self.original_sites_path

	def test_stylesheet_link_replaced_with_inline_style(self):
		html = (
			'<head><link type="text/css" rel="stylesheet" '
			'href="/assets/frappe/dist/css/print.bundle.ABC123.css">'
			"<style>body { font-size: 14px; }</style></head>"
		)

		result = rewards_sync._inline_stylesheet_links(html)

		self.assertNotIn("rel=\"stylesheet\"", result)
		self.assertNotIn("<link", result)
		self.assertIn(".print-format-gutter { background: red; }", result)
		# The receipt's own inline style must survive untouched.
		self.assertIn("body { font-size: 14px; }", result)

	def test_missing_asset_drops_the_link_instead_of_raising(self):
		html = (
			'<link rel="stylesheet" href="/assets/frappe/dist/css/'
			'does-not-exist.css"><style>body {}</style>'
		)

		result = rewards_sync._inline_stylesheet_links(html)

		self.assertNotIn("<link", result)
		self.assertIn("<style>body {}</style>", result)
