// Leave the POS for the Desk home page, as the opening dialog's Close
// button does.
export function goToDesk() {
	(frappe as any).set_route("/");
	location.reload();
}
