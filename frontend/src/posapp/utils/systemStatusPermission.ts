export function canShowSystemStatus(
	frappeContext: any = typeof window !== "undefined"
		? (window as any).frappe
		: undefined,
) {
	const user = String(frappeContext?.session?.user || "").trim();
	if (!user || user === "Guest") return false;
	if (user === "Administrator") return true;

	// frappe.user_roles is set equal to frappe.boot.user.roles at desk boot
	// (frappe/public/js/frappe/desk.js) -- boot.user.roles is the single
	// canonical source, no need to also check frappe.user_roles.
	const roles = Array.isArray(frappeContext?.boot?.user?.roles)
		? frappeContext.boot.user.roles
		: [];

	return roles.includes("System Manager");
}
