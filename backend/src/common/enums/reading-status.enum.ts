/** Where the owner stands on a book the landing "reading" section renders. */
export enum ReadingStatus {
  /** Currently being read; the landing headline state. */
  READING = 'reading',
  /** Finished; the landed review usually exists here. */
  FINISHED = 'finished',
  /** Picked up next; queued on the shelf. */
  QUEUED = 'queued',
}
