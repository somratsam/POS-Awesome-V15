import api from "./api";
import type { ApiEnvelope } from "./api";

const authService = {
	logout(): Promise<ApiEnvelope<any>> {
		return api.callEnvelope("logout");
	},

	// Log out, then send the browser to the login page with a redirect back
	// to the POS.
	logoutToPosLogin(): Promise<void> {
		const loginPath = `/login?redirect-to=${encodeURIComponent("/app/posapp")}`;
		return authService.logout().finally(() => {
			const desk = frappe as any;
			const loginUrl =
				desk?.utils?.get_url?.(loginPath) ??
				(desk?.urllib?.get_base_url?.() ? `${desk.urllib.get_base_url()}${loginPath}` : loginPath);
			window.location.href = loginUrl;
		}) as Promise<any>;
	},

	getUser(): string | null {
		if (typeof frappe !== "undefined" && frappe.session) {
			return frappe.session.user;
		}
		return null;
	},
};

export default authService;
