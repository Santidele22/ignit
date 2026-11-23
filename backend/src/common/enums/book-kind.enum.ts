/**
 * Which shelf a book belongs to on the landing "lectura" block
 * (`personal-app/src/widgets/reading/Reading.astro`): `tecnico` gathers the
 * dev/architecture/testing reading, `no_tecnico` the novels and general
 * non-fiction. `NO_TECNICO` is the default so a book without an explicit
 * kind lands on the less-assumed shelf instead of the technical one.
 */
export enum BookKind {
  TECNICO = 'tecnico',
  NO_TECNICO = 'no_tecnico',
}
