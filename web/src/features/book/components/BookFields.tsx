import { AdminField } from '../../../shared/ui/admin/AdminField';
import { AdminSelectField } from '../../../shared/ui/admin/AdminSelectField';
import { adminHintClass } from '../../../shared/ui/admin/styles';
import { BOOK_KIND_OPTIONS, BOOK_STATUS_OPTIONS, OPEN_LICENSE_SELECT_OPTIONS } from '../bookForm';
import type { BookFormState } from '../bookForm';

export type BookFieldsProps = {
	form: BookFormState;
	prefix: string;
	disabled?: boolean;
	onInput: <K extends keyof BookFormState>(key: K, value: BookFormState[K]) => void;
};

export function BookFields(props: BookFieldsProps) {
	return (
		<div class="grid gap-5 sm:grid-cols-2">
			<AdminField
				id={`${props.prefix}-title`}
				label="TÍTULO"
				value={props.form.title}
				disabled={props.disabled}
				onInput={(value) => props.onInput('title', value)}
			/>
			<AdminField
				id={`${props.prefix}-author`}
				label="AUTOR"
				value={props.form.author}
				placeholder="Quién lo escribió"
				disabled={props.disabled}
				onInput={(value) => props.onInput('author', value)}
			/>
			<div class="sm:col-span-2">
				<AdminField
					id={`${props.prefix}-description`}
					label="DESCRIPCIÓN"
					value={props.form.description}
					multiline
					rows={3}
					disabled={props.disabled}
					onInput={(value) => props.onInput('description', value)}
				/>
			</div>
			<AdminSelectField
				id={`${props.prefix}-status`}
				label="ESTADO"
				value={props.form.status}
				options={BOOK_STATUS_OPTIONS}
				disabled={props.disabled}
				onInput={(value) => props.onInput('status', value)}
			/>
			<AdminSelectField
				id={`${props.prefix}-kind`}
				label="CATEGORÍA"
				value={props.form.kind}
				options={BOOK_KIND_OPTIONS}
				hint="Se usa para filtrar en tu biblioteca y en el catálogo público."
				disabled={props.disabled}
				onInput={(value) => props.onInput('kind', value)}
			/>
			<div class="sm:col-span-2">
				<AdminField
					id={`${props.prefix}-review`}
					label="RESEÑA"
					value={props.form.review}
					multiline
					rows={4}
					hint="Opcional: si la dejás vacía, el libro se muestra sin comentario."
					disabled={props.disabled}
					onInput={(value) => props.onInput('review', value)}
				/>
			</div>
			<div class="sm:col-span-2">
				<AdminSelectField
					id={`${props.prefix}-license`}
					label="LICENCIA ABIERTA"
					value={props.form.license ?? ''}
					options={
						props.form.license && !OPEN_LICENSE_SELECT_OPTIONS.some((o) => o.value === props.form.license)
							? [...OPEN_LICENSE_SELECT_OPTIONS, { value: props.form.license, label: props.form.license }]
							: OPEN_LICENSE_SELECT_OPTIONS
					}
					hint="Obligatoria para el catálogo público (dominio público, Creative Commons, Open Source o documentación libre)."
					disabled={props.disabled}
					onInput={(value) => props.onInput('license', value)}
				/>
			</div>
			<div class="sm:col-span-2">
				<label class="flex w-fit items-center gap-3">
					<input
						type="checkbox"
						checked={props.form.published}
						disabled={props.disabled}
						onChange={(event) => props.onInput('published', event.currentTarget.checked)}
						class="size-4 rounded-sm border border-border bg-background accent-aka disabled:cursor-not-allowed disabled:opacity-60"
					/>
					<span class="text-[11px] font-medium tracking-[0.2em] text-muted-foreground">
						PUBLICAR EN EL CATÁLOGO PÚBLICO (SOLO LICENCIAS ABIERTAS)
					</span>
				</label>
				<p class={adminHintClass}>
					Si lo dejás sin marcar, queda en tu biblioteca privada para leer en Modo Vigilia. Para salir en el catálogo
					público requiere licencia abierta y aprobación administrativa.
				</p>
			</div>
		</div>
	);
}
