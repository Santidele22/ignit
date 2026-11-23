export interface PipelineStep {
	step: '1' | '2' | '3' | '4';
	num: string;
	title: string;
	badge: string;
	description: string;
	caption: string;
}

export const PIPELINE_STEPS: readonly PipelineStep[] = [
	{
		step: '1',
		num: '01',
		title: 'Standby',
		badge: 'seguridad + gate humano',
		description:
			'El PDF entra en cuarentena. Se analiza estructura, scripts ocultos y duplicados por hash antes de aprobarlo.',
		caption: '01 · standby — cuarentena y seguridad',
	},
	{
		step: '2',
		num: '02',
		title: 'En curso',
		badge: 'scrapeo automático',
		description:
			'Aprobado el archivo, el extractor procesa páginas, párrafos y capítulos para generar el documento liviano de Vigilia.',
		caption: '02 · en curso — scrapeo automático',
	},
	{
		step: '3',
		num: '03',
		title: 'Tested',
		badge: 'QA de formato + tipo',
		description:
			'Se previsualiza dentro de Vigilia para verificar que el formato salga limpio y confirmar su clasificación definitiva.',
		caption: '03 · tested — preview en Vigilia',
	},
	{
		step: '4',
		num: '04',
		title: 'Catálogo',
		badge: 'publicado para todos',
		description:
			'El libro aparece en el catálogo público, listo para leer online en Vigilia desde cualquier dispositivo.',
		caption: '04 · catálogo — publicado para todos',
	},
];

export function pipelineCaptionForStep(step: string): string {
	const found = PIPELINE_STEPS.find((item) => item.step === step);
	return (found ?? PIPELINE_STEPS[0]!).caption;
}
