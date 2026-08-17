# Copyright (c) 2026, Youssef Restom and contributors
# For license information, please see license.txt

"""Pushes a computed loyalty summary + recent activity to the separate
rewards portal site (rewards.staging.local) over an authenticated HTTP
call. Runs on this (the main) site, since only here does Customer/Sales
Invoice/Loyalty Point Entry data actually exist -- the rewards site has no
ERPNext/POS Awesome installed by design, to keep it decoupled.

Two entry points, both wired via scheduler_events in hooks.py:
- run_incremental_sync(): every 15 minutes, only rows changed since the
  last watermark.
- run_full_refresh(): once daily, every non-generic customer regardless of
  whether anything changed -- catches loyalty-point *expiry*, which shifts
  a customer's balance with no corresponding "modified" timestamp anywhere
  for a watermark to catch.

Generic/walk-in customers (posa_is_generic_customer) are excluded at the
source query itself -- they are never computed, never batched, never sent.

Also pushes Swan's public store info (website, phone, Shop-type Address
records) every run -- small, rarely-changing, no watermark needed. The
company is resolved dynamically via an active POS Profile rather than a
hardcoded company name, matching how posa_is_generic_customer replaced a
hardcoded "Anonymous" check earlier in this project.

Receipt PDFs (Step 8): generated only during incremental runs, gated by
Sales Invoice.posa_receipt_synced so an already-synced receipt is never
regenerated -- set only after a confirmed successful push, so a failed
run retries on the next tick rather than silently losing the receipt.
Full-refresh never touches receipts; its job is catching summary drift
(e.g. point expiry), not re-processing immutable invoices. PDF generation
requires frappe.utils.set_request() since the scheduler has no real HTTP
request (frappe.get_print() otherwise raises inside Werkzeug's
context-local proxy), and a custom 76mm page width matching the print
format's own thermal-receipt CSS (the PDF default is A4, which silently
split every receipt across a mostly-blank 2nd page).
"""

import base64
import io

import frappe
import requests
from erpnext.accounts.doctype.loyalty_program.loyalty_program import (
	get_loyalty_program_details_with_points,
)
from frappe.utils import now_datetime

BATCH_SIZE = 100
RECEIPT_BATCH_SIZE = 20
REQUEST_TIMEOUT = 30
RECEIPT_PAGE_WIDTH = "76mm"
RECEIPT_PAGE_HEIGHT = "400mm"


def run_incremental_sync():
	_run_sync(full_refresh=False)


def run_full_refresh():
	_run_sync(full_refresh=True)


def _run_sync(full_refresh):
	settings = frappe.get_single("Rewards Sync Settings")
	if not settings.rewards_site_url or not settings.api_key:
		frappe.log_error(
			title="Rewards sync not configured",
			message="Rewards Sync Settings is missing rewards_site_url or api_key.",
		)
		return

	watermark = settings.last_incremental_sync

	changed_customers = set(_get_changed_customers(watermark, full_refresh))
	invoice_rows = _get_invoices_to_sync(watermark, full_refresh)

	# A customer with a new/changed invoice needs a refreshed loyalty
	# summary even if their own Customer doc didn't change.
	changed_customers |= {row["customer"] for row in invoice_rows}

	customer_payloads = [_build_customer_payload(name) for name in changed_customers]
	customer_payloads = [p for p in customer_payloads if p is not None]

	store_locations = _get_store_locations()
	store_contact = _get_store_contact()

	sync_type = "Full Refresh" if full_refresh else "Incremental"

	receipts_generated_for = [] if full_refresh else _attach_receipts(invoice_rows)

	try:
		_push_batches(settings, customer_payloads, invoice_rows, store_locations, store_contact, sync_type)
	except Exception:
		frappe.log_error(title="Rewards sync push failed", message=frappe.get_traceback())
		return

	for invoice_name in receipts_generated_for:
		frappe.db.set_value("Sales Invoice", invoice_name, "posa_receipt_synced", 1, update_modified=False)
	if receipts_generated_for:
		frappe.db.commit()

	now = now_datetime()
	settings.last_incremental_sync = now
	if full_refresh:
		settings.last_full_refresh = now.date()
	settings.save(ignore_permissions=True)
	frappe.db.commit()


def _get_changed_customers(watermark, full_refresh):
	filters = {"posa_is_generic_customer": ["!=", 1]}
	if not full_refresh and watermark:
		filters["modified"] = [">", watermark]
	return frappe.get_all("Customer", filters=filters, pluck="name")


def _get_invoices_to_sync(watermark, full_refresh):
	filters = {"docstatus": 1}
	if not full_refresh and watermark:
		filters["modified"] = [">", watermark]

	rows = frappe.get_all(
		"Sales Invoice",
		filters=filters,
		fields=["name as source_invoice_id", "customer", "grand_total", "posting_date"],
	)

	generic_customers = set(
		frappe.get_all("Customer", filters={"posa_is_generic_customer": 1}, pluck="name")
	)

	result = []
	for row in rows:
		if row["customer"] in generic_customers:
			continue
		result.append(
			{
				"source_invoice_id": row["source_invoice_id"],
				"customer": row["customer"],
				"grand_total": float(row["grand_total"] or 0),
				"posting_date": str(row["posting_date"]) if row["posting_date"] else None,
			}
		)
	return result


def _build_customer_payload(customer_name):
	customer = frappe.db.get_value(
		"Customer",
		customer_name,
		[
			"customer_name",
			"mobile_no",
			"posa_loyalty_portal_code",
			"loyalty_program",
			"posa_is_generic_customer",
		],
		as_dict=True,
	)
	if not customer or customer.posa_is_generic_customer:
		return None

	loyalty_points = 0
	loyalty_value = 0
	expiry_amount = 0
	expiry_date = None

	if customer.loyalty_program:
		details = get_loyalty_program_details_with_points(
			customer_name,
			customer.loyalty_program,
			silent=True,
			include_expired_entry=False,
		)
		loyalty_points = details.get("loyalty_points") or 0
		conversion_factor = details.get("conversion_factor") or 0
		loyalty_value = loyalty_points * conversion_factor

		nearest_expiry = frappe.db.sql(
			"""
			SELECT expiry_date, SUM(loyalty_points) AS points
			FROM `tabLoyalty Point Entry`
			WHERE customer = %s
			  AND loyalty_program = %s
			  AND expiry_date >= CURDATE()
			  AND loyalty_points > 0
			GROUP BY expiry_date
			ORDER BY expiry_date ASC
			LIMIT 1
			""",
			(customer_name, customer.loyalty_program),
			as_dict=True,
		)
		if nearest_expiry:
			expiry_amount = float(nearest_expiry[0]["points"] or 0)
			expiry_date = nearest_expiry[0]["expiry_date"]

	return {
		"source_customer_id": customer_name,
		"customer_name": customer.customer_name,
		"mobile_no": customer.mobile_no,
		"loyalty_portal_code": customer.posa_loyalty_portal_code,
		"loyalty_points": float(loyalty_points or 0),
		"loyalty_value": float(loyalty_value or 0),
		"expiry_amount": expiry_amount,
		"expiry_date": str(expiry_date) if expiry_date else None,
	}


def _attach_receipts(invoice_rows):
	"""Mutates each row in-place, adding receipt_pdf_base64 for any invoice
	that doesn't already have a synced receipt. Returns the list of invoice
	names actually generated this run, for the caller to mark synced only
	after a confirmed successful push."""
	generated_for = []
	for row in invoice_rows:
		invoice_name = row["source_invoice_id"]
		if frappe.db.get_value("Sales Invoice", invoice_name, "posa_receipt_synced"):
			continue
		try:
			pdf_bytes = _generate_receipt_pdf(invoice_name)
		except Exception:
			frappe.log_error(
				title="Receipt PDF generation failed",
				message=f"invoice={invoice_name}\n{frappe.get_traceback()}",
			)
			continue
		row["receipt_pdf_base64"] = base64.b64encode(pdf_bytes).decode("ascii")
		generated_for.append(invoice_name)
	return generated_for


def _generate_receipt_pdf(invoice_name):
	from frappe.utils import set_request
	from frappe.utils.pdf import get_pdf

	if not getattr(frappe.local, "request", None):
		# 127.0.0.1, not frappe.local.site: wkhtmltopdf resolves this base_url
		# itself (a separate OS subprocess, not routed through the app's own
		# request handling), and a site's configured name (e.g. site1.local)
		# has no reason to be DNS-resolvable from wherever that subprocess
		# runs. The loopback IP needs no resolution at all, so it works
		# identically regardless of the site's name or environment.
		port = frappe.local.conf.webserver_port or 80
		set_request(method="GET", path="/", base_url=f"http://127.0.0.1:{port}")

	html = frappe.get_print("Sales Invoice", invoice_name, print_format="Swan Sales Invoice", no_letterhead=True)

	pdf_options = {
		"page-width": RECEIPT_PAGE_WIDTH,
		"page-height": RECEIPT_PAGE_HEIGHT,
		"margin-left": "0mm",
		"margin-right": "0mm",
		"margin-top": "2mm",
		"margin-bottom": "2mm",
	}
	pdf_bytes = get_pdf(html, options=pdf_options)
	return _strip_blank_trailing_pages(pdf_bytes)


def _strip_blank_trailing_pages(pdf_bytes):
	# wkhtmltopdf's page-height estimation for a short receipt on a tall
	# custom page reliably leaves a trailing blank page; strip any page
	# with no extractable text rather than trying to guess an exact height
	# per receipt (which would vary with item count).
	from pypdf import PdfReader, PdfWriter

	reader = PdfReader(io.BytesIO(pdf_bytes))
	writer = PdfWriter()
	for page in reader.pages:
		if page.extract_text().strip():
			writer.add_page(page)
	if len(writer.pages) == 0 and len(reader.pages) > 0:
		writer.add_page(reader.pages[0])

	buf = io.BytesIO()
	writer.write(buf)
	return buf.getvalue()


def _get_store_locations():
	return frappe.db.sql(
		"""
		SELECT a.name AS source_address_id, a.address_title AS title,
		       a.city, a.address_line1, a.phone
		FROM `tabAddress` a
		JOIN `tabDynamic Link` dl ON dl.parent = a.name AND dl.parenttype = 'Address'
		WHERE dl.link_doctype = 'Company' AND a.address_type = 'Shop'
		ORDER BY a.address_title ASC
		""",
		as_dict=True,
	)


def _get_store_contact():
	company = frappe.get_all("POS Profile", filters={"disabled": 0}, pluck="company", limit=1)
	if not company:
		return None
	website, phone = frappe.db.get_value("Company", company[0], ["website", "phone_no"])
	return {"website": website, "phone": phone}


def _push_batches(settings, customer_payloads, invoice_rows, store_locations, store_contact, sync_type):
	api_secret = settings.get_password("api_secret")
	headers = {
		"Authorization": f"token {settings.api_key}:{api_secret}",
	}
	url = settings.rewards_site_url.rstrip("/") + "/api/method/swan_rewards.swan_rewards.api.sync.ingest"

	requests_to_send = []
	for i in range(0, len(customer_payloads), BATCH_SIZE):
		requests_to_send.append({"customers": customer_payloads[i : i + BATCH_SIZE], "invoices": []})
	for i in range(0, len(invoice_rows), RECEIPT_BATCH_SIZE):
		requests_to_send.append({"customers": [], "invoices": invoice_rows[i : i + RECEIPT_BATCH_SIZE]})
	if not requests_to_send:
		# Still record that this run happened (0 rows to sync is a valid,
		# common outcome for a 15-minute incremental tick).
		requests_to_send.append({"customers": [], "invoices": []})

	# Store info is small and rarely changes -- piggyback it on the first
	# request of the run rather than a dedicated extra round-trip.
	requests_to_send[0]["store_locations"] = store_locations
	requests_to_send[0]["store_contact"] = store_contact

	for payload in requests_to_send:
		payload["sync_type"] = sync_type
		_post(url, headers, payload)


def _post(url, headers, payload):
	response = requests.post(url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT)
	response.raise_for_status()
	return response.json()
