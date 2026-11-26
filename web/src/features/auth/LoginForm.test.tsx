// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import LoginForm from './LoginForm';
import { signInWithEmail } from './api/authActions';

vi.mock('./api/authActions', () => ({
	signInWithEmail: vi.fn(),
}));

const signInWithEmailMock = vi.mocked(signInWithEmail);

describe('LoginForm', () => {
	let assignSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		signInWithEmailMock.mockReset();
		assignSpy = vi.fn();
		Object.defineProperty(window, 'location', {
			configurable: true,
			value: {
				...window.location,
				search: '',
				assign: assignSpy,
			},
		});
	});

	afterEach(() => {
		cleanup();
	});

	it('redirects admin users directly to /admin when no explicit redirect param is present', async () => {
		signInWithEmailMock.mockResolvedValue({
			error: null,
			user: { id: 'a1', email: 'ignit677@gmail.com', role: 'admin' },
		});

		const { container } = render(() => <LoginForm />);
		fireEvent.input(container.querySelector('#login-email')!, {
			target: { value: 'ignit677@gmail.com' },
		});
		fireEvent.input(container.querySelector('#login-password')!, {
			target: { value: 'secret1234' },
		});
		fireEvent.submit(container.querySelector('form')!);

		await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/admin'));
	});

	it('redirects regular users to /biblioteca when no explicit redirect param is present', async () => {
		signInWithEmailMock.mockResolvedValue({
			error: null,
			user: { id: 'u1', email: 'reader@example.com', role: 'user' },
		});

		const { container } = render(() => <LoginForm />);
		fireEvent.input(container.querySelector('#login-email')!, {
			target: { value: 'reader@example.com' },
		});
		fireEvent.input(container.querySelector('#login-password')!, {
			target: { value: 'secret1234' },
		});
		fireEvent.submit(container.querySelector('form')!);

		await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/biblioteca'));
	});

	it('respects an explicit safe redirect query param even for admins', async () => {
		window.location.search = '?redirect=%2Flecturas%2F7';
		signInWithEmailMock.mockResolvedValue({
			error: null,
			user: { id: 'a1', email: 'ignit677@gmail.com', role: 'admin' },
		});

		const { container } = render(() => <LoginForm />);
		fireEvent.input(container.querySelector('#login-email')!, {
			target: { value: 'ignit677@gmail.com' },
		});
		fireEvent.input(container.querySelector('#login-password')!, {
			target: { value: 'secret1234' },
		});
		fireEvent.submit(container.querySelector('form')!);

		await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/lecturas/7'));
	});
});
