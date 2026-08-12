from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import patch

from posawesome.posawesome.api import items


class _FakeProfileDoc(dict):
    """Minimal stand-in for the frappe.get_doc("POS Profile", ...) result
    get_authorized_pos_profile() returns -- dict-like `.get()` access plus
    `.as_dict()`, matching what get_delta_items() now relies on."""

    __getattr__ = dict.get

    def as_dict(self):
        return dict(self)


class TestGetDeltaItemsAuthorization(unittest.TestCase):
    """get_delta_items() must re-resolve and re-authorize the POS Profile
    server-side via get_authorized_pos_profile(), not trust a client-supplied
    dict verbatim -- _collect_delta_item_codes() reads warehouse straight off
    it for a direct Bin query, same as get_items()."""

    def test_uses_the_authorized_profiles_warehouse_for_the_delta_bin_lookup(self):
        authorized_profile = _FakeProfileDoc(
            {
                "name": "Authorized-Profile",
                "warehouse": "Authorized Warehouse",
                "selling_price_list": "Retail",
                "posa_show_template_items": 0,
                "posa_hide_variants_items": 0,
            }
        )
        recorded_warehouse_queries = []

        def fake_collect_delta_item_codes(pos_profile, modified_after, price_list, limit):
            recorded_warehouse_queries.append(pos_profile.get("warehouse"))
            return []

        with (
            patch.object(items, "get_authorized_pos_profile", return_value=authorized_profile),
            patch.object(items, "get_items", return_value=[]),
            patch.object(
                items,
                "_collect_delta_item_codes",
                side_effect=fake_collect_delta_item_codes,
            ),
        ):
            items.get_delta_items(
                {"name": "Client-Claimed-Profile", "warehouse": "Client-Claimed-Warehouse"},
                modified_after=datetime(2026, 1, 1).isoformat(),
            )

        # The resolved warehouse used for the Bin lookup comes from what
        # get_authorized_pos_profile() actually returned, not from the
        # client's own claim about which warehouse it is.
        self.assertEqual(recorded_warehouse_queries, ["Authorized Warehouse"])

    def test_passes_the_authorized_profile_name_through_to_get_items(self):
        authorized_profile = _FakeProfileDoc(
            {
                "name": "Authorized-Profile",
                "warehouse": "Authorized Warehouse",
                "selling_price_list": "Retail",
            }
        )
        recorded_get_items_calls = []

        def fake_get_items(pos_profile, **kwargs):
            recorded_get_items_calls.append(pos_profile)
            return []

        with (
            patch.object(items, "get_authorized_pos_profile", return_value=authorized_profile),
            patch.object(items, "get_items", side_effect=fake_get_items),
        ):
            items.get_delta_items(
                "Client-Claimed-Profile",
                modified_after=datetime(2026, 1, 1).isoformat(),
            )

        # get_items() independently re-authorizes from just the name -- no
        # need to thread a client-derived JSON blob through it.
        self.assertEqual(recorded_get_items_calls, ["Authorized-Profile"])

    def test_passes_the_authorized_profile_name_through_to_get_items_details(self):
        """Regression test: get_delta_items() previously referenced a stale
        `profile_json` variable when enriching delta item codes via
        get_items_details(), raising NameError in production. That branch
        only runs when base_items didn't already satisfy the limit and
        _collect_delta_item_codes() found codes beyond them -- none of the
        other tests in this file reach it, which is why the bug shipped."""
        authorized_profile = _FakeProfileDoc(
            {
                "name": "Authorized-Profile",
                "warehouse": "Authorized Warehouse",
                "selling_price_list": "Retail",
                "posa_show_template_items": 1,
                "posa_hide_variants_items": 0,
            }
        )
        recorded_get_items_details_calls = []

        def fake_get_items_details(pos_profile, items_data, **kwargs):
            recorded_get_items_details_calls.append(pos_profile)
            return []

        with (
            patch.object(items, "get_authorized_pos_profile", return_value=authorized_profile),
            patch.object(items, "get_items", return_value=[]),
            patch.object(items, "_collect_delta_item_codes", return_value={"ITEM-001"}),
            patch.object(items, "get_item_groups", return_value=[]),
            patch.object(items, "expand_item_groups", return_value=[]),
            patch.object(items, "installed_item_search_fields", return_value=[]),
            patch.object(
                items.frappe,
                "get_all",
                return_value=[{"item_code": "ITEM-001", "item_name": "Item 001"}],
            ),
            patch.object(items, "get_items_details", side_effect=fake_get_items_details),
        ):
            items.get_delta_items(
                "Client-Claimed-Profile",
                modified_after=datetime(2026, 1, 1).isoformat(),
            )

        # Must be the authorized profile's own name, not an undefined
        # variable or the client's unverified claim.
        self.assertEqual(recorded_get_items_details_calls, ["Authorized-Profile"])

    def test_propagates_a_permission_error_from_an_unauthorized_profile(self):
        class Denied(Exception):
            pass

        with patch.object(items, "get_authorized_pos_profile", side_effect=Denied("not authorized")):
            with self.assertRaises(Denied):
                items.get_delta_items(
                    "Someone Elses Profile",
                    modified_after=datetime(2026, 1, 1).isoformat(),
                )


if __name__ == "__main__":
    unittest.main()
