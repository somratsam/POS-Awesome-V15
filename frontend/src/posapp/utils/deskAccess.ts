// Who may leave the POS for the Desk: users with Desk access, which Frappe
// records as user_type "System User" (a role with desk_access;
// frappe/core/doctype/user/user.py). frappe.boot.user is
// frappe.get_user().load_user(), which includes user_type.
export function canUseDesk(
	frappeContext: any = typeof window !== "undefined" ? (window as any).frappe : undefined,
) {
	const user = String(frappeContext?.session?.user || "").trim();
	if (!user || user === "Guest") return false;
	if (user === "Administrator") return true;
	return frappeContext?.boot?.user?.user_type === "System User";
}
