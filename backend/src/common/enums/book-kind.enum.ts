/**
 * Catalog categories for Ignit's shelves and filters.
 * `NO_TECNICO` ("General") is kept as the backward-compatible default for
 * existing rows and creates without an explicit category.
 */
export enum BookKind {
  TECNICO = 'tecnico',
  CIENCIA = 'ciencia',
  DERECHO = 'derecho',
  MEDICINA = 'medicina',
  ECONOMIA = 'economia',
  DISENO = 'diseno',
  FICCION = 'ficcion',
  TERROR_SCIFI = 'terror_scifi',
  FILOSOFIA = 'filosofia',
  HISTORIA = 'historia',
  POESIA = 'poesia',
  NO_TECNICO = 'no_tecnico',
}
