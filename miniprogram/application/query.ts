import { sortRecords, type PracticeRecord } from '../domain/model';
export type RecordCursor = Pick<PracticeRecord, 'occurredOn' | 'createdAt' | 'id'>;
/** Cursor order is stable across equal dates/timestamps and does not depend on array offsets. */
export function recordPage(
  records: PracticeRecord[],
  projectId: string,
  cursor: RecordCursor | null = null,
  limit = 20,
) {
  const rows = sortRecords(records.filter((r) => r.projectId === projectId));
  const after = cursor
    ? rows.filter(
        (r) =>
          r.occurredOn < cursor.occurredOn ||
          (r.occurredOn === cursor.occurredOn &&
            (r.createdAt < cursor.createdAt ||
              (r.createdAt === cursor.createdAt && r.id < cursor.id))),
      )
    : rows;
  const items = after.slice(0, limit);
  return {
    items,
    cursor: items.length ? items[items.length - 1] : cursor,
    hasMore: after.length > items.length,
  };
}
