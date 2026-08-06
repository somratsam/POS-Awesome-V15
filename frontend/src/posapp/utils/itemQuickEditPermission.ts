const parseEnabled = (value: unknown) =>
	value === true || value === 1 || value === "1" || value === "true";

export function canShowItemQuickEdit(
	posProfile: Record<string, any> | null | undefined,
	frappeContext: any = typeof window !== "undefined"
		? (window as any).frappe
		: undefined,
) {
	const user = String(frappeContext?.session?.user || "").trim();
	if (!user || user === "Guest") return false;

	// frappe.user_roles is set equal to frappe.boot.user.roles at desk boot
	// (frappe/public/js/frappe/desk.js) -- boot.user.roles is the single
	// canonical source, no need to also check frappe.user_roles.
	const roles = Array.isArray(frappeContext?.boot?.user?.roles)
		? frappeContext.boot.user.roles
		: [];

	return (
		parseEnabled(posProfile?.posa_allow_item_quick_edit) &&
		roles.includes("POS Awesome Supervisor")
	);
}
