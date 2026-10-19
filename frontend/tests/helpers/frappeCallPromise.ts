// frappe.call returns jQuery's $.ajax() result: a jQuery 3 promise with
// then/catch/done/fail/always but no finally (also after .then()). A native
// Promise in a frappe.call mock hides code that relies on .finally, which
// then breaks in the real app ("...finally is not a function").

export type JQueryLikePromise<T> = {
	then<R1 = T, R2 = never>(
		onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
		onRejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
	): JQueryLikePromise<R1 | R2>;
	catch<R = never>(onRejected?: ((reason: any) => R | PromiseLike<R>) | null): JQueryLikePromise<T | R>;
	done(fn: (value: T) => void): JQueryLikePromise<T>;
	fail(fn: (reason: any) => void): JQueryLikePromise<T>;
	always(fn: (valueOrReason: any) => void): JQueryLikePromise<T>;
};

export function jqueryPromise<T>(source: Promise<T>): JQueryLikePromise<T> {
	const promise: JQueryLikePromise<T> = {
		then: (onFulfilled, onRejected) => jqueryPromise(source.then(onFulfilled, onRejected)) as any,
		catch: (onRejected) => jqueryPromise(source.catch(onRejected)) as any,
		done: (fn) => {
			source.then(fn, () => undefined);
			return promise;
		},
		fail: (fn) => {
			source.then(undefined, fn);
			return promise;
		},
		always: (fn) => {
			source.then(fn, fn);
			return promise;
		},
	};
	return promise;
}

export const frappeCallResolved = <T>(value: T) => jqueryPromise(Promise.resolve(value));

export const frappeCallRejected = (reason: unknown) => jqueryPromise(Promise.reject(reason));

// A call that stays in flight until the test settles it.
export function frappeCallPending<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const source = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise: jqueryPromise(source), resolve, reject };
}
