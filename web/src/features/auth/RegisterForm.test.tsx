// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import RegisterForm from './RegisterForm';
import { signUpWithEmail } from './api/authActions';

vi.mock('./api/authActions', () => ({
	signUpWithEmail: vi.fn(),
}));

const signUpWithEmailMock = vi.mocked(signUpWithEmail);

describe('RegisterForm', () => {
	let assignSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		signUpWithEmailMock.mockReset();
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

	it('shows an informative confirmation modal when account creation succeeds and navigates on confirmation', async () => {
		signUpWithEmailMock.mockResolvedValue({ error: null });

		const { container, getByRole } = render(() => <RegisterForm />);

		fireEvent.input(container.querySelector('#register-name')!, { target: { value: 'Santiago' } });
		fireEvent.input(container.querySelector('#register-email')!, {
			target: { value: 'ezedelebecq22@gmail.com' },
		});
		fireEvent.input(container.querySelector('#register-password')!, {
			target: { value: 'secret1234' },
		});
		fireEvent.submit(container.querySelector('form')!);

		await waitFor(() => {
			const dialog = getByRole('dialog');
			expect(dialog.getAttribute('aria-modal')).toBe('true');
			expect(dialog.textContent).toContain('Cuenta creada');
			expect(dialog.textContent).toContain('ezedelebecq22@gmail.com');
		});

		// Must NOT jump silently before the user sees the confirmation modal.
		expect(assignSpy).not.toHaveBeenCalled();

		const continueButton = [...container.querySelectorAll('button')].find((btn) =>
			(btn.textContent ?? '').includes('Entrar a mi biblioteca'),
		);
		expect(continueButton).toBeDefined();
		expect(document.activeElement).toBe(continueButton);
		fireEvent.click(continueButton!);

		expect(assignSpy).toHaveBeenCalledWith('/biblioteca');
	});

	it('also navigates when pressing Escape while the confirmation modal is open', async () => {
		signUpWithEmailMock.mockResolvedValue({ error: null });

		const { container, getByRole } = render(() => <RegisterForm />);

		fireEvent.input(container.querySelector('#register-name')!, { target: { value: 'Santiago' } });
		fireEvent.input(container.querySelector('#register-email')!, {
			target: { value: 'ezedelebecq22@gmail.com' },
		});
		fireEvent.input(container.querySelector('#register-password')!, {
			target: { value: 'secret1234' },
		});
		fireEvent.submit(container.querySelector('form')!);

		await waitFor(() => expect(getByRole('dialog')).toBeTruthy());
		fireEvent.keyDown(window, { key: 'Escape' });

		expect(assignSpy).toHaveBeenCalledWith('/biblioteca');
	});

	it('renders an inline error alert and no success modal when sign-up fails', async () => {
		signUpWithEmailMock.mockResolvedValue({
			error: { status: 409, message: 'Ya existe una cuenta registrada con ese correo.' },
		});

		const { container, queryByRole } = render(() => <RegisterForm />);

		fireEvent.input(container.querySelector('#register-name')!, { target: { value: 'Santiago' } });
		fireEvent.input(container.querySelector('#register-email')!, {
			target: { value: 'ezedelebecq22@gmail.com' },
		});
		fireEvent.input(container.querySelector('#register-password')!, {
			target: { value: 'secret1234' },
		});
		fireEvent.submit(container.querySelector('form')!);

		await waitFor(() => {
			const alert = container.querySelector('[role="alert"]');
			expect(alert?.textContent).toContain('Ya existe una cuenta registrada con ese correo.');
		});

		expect(queryByRole('dialog')).toBeNull();
		expect(assignSpy).not.toHaveBeenCalled();
	});
});
