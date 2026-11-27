import {
  dateKey,
  factors,
  metricOrder,
  palettes,
  total,
  type Database,
  type Metric,
} from '../domain/model';
import { calendarHeatmap } from '../domain/calendar-heatmap';
import { statistics, type Period } from '../domain/statistics';
import { metricParts, metricText } from './presentation';

/** Sharing is a read-only projection of a committed project, never a second persistence format. */
export type ShareSelection =
  | { kind: 'record'; projectId: string; recordId: string }
  | {
      kind: 'statistics';
      projectId: string;
      graph: 'cumulative' | 'distribution' | 'calendar';
      metric: Metric;
      period: Period;
      offset: number;
      calendarOffset: number;
    };
export interface ShareSnapshot {
  kind: 'record' | 'statistics';
  name: string;
  icon: string;
  colorId: string;
  color: string;
  title: string;
  date: string;
  metrics: { label: string; number: string; unit: string }[];
  note: string;
  summary: string;
  count: string;
  filename: string;
  description: string;
  graph: 'cumulative' | 'distribution' | 'calendar';
  values: number[];
  labels: string[];
  baseline: number;
  cells: { day: string; level: number; future: boolean; missing: boolean }[];
}

/** Validate all sibling revisions: statistics and calendars depend on more than the shared record. */
export function shareSourceVersion(db: Database, projectId: string): string {
  const project = db.projects.find((p) => p.id === projectId);
  return project
    ? JSON.stringify([
        project,
        db.records
          .filter((r) => r.projectId === projectId)
          .map((r) => [r.id, r.revision, r.updatedAt])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ])
    : '';
}

/** Preserve missing measurements and exact whole-second arithmetic; only the final display uses selected units. */
export function shareSnapshot(
  db: Database,
  selection: ShareSelection,
  today = dateKey(),
): ShareSnapshot {
  const p = db.projects.find((p) => p.id === selection.projectId);
  if (!p) throw new Error('此项目已不存在');
  const rows = db.records.filter((r) => r.projectId === p.id && r.occurredOn <= today);
  const snapshot: ShareSnapshot = {
    kind: selection.kind,
    name: p.name,
    icon: p.icon,
    colorId: p.color,
    color: palettes[p.color],
    title: '',
    date: '',
    metrics: [],
    note: '',
    summary: '',
    count: '',
    filename: 'polaris',
    description: '',
    graph: 'cumulative',
    values: [],
    labels: [],
    baseline: 0,
    cells: [],
  };
  if (selection.kind === 'record') {
    const record = rows.find((r) => r.id === selection.recordId);
    if (!record) throw new Error('此记录已不存在');
    const project = { ...p, quantityUnit: record.quantityUnit || p.quantityUnit };
    const metrics = metricOrder(p).filter((m) => record[m] != null);
    Object.assign(snapshot, {
      title: '打卡成功',
      date:
        record.occurredOn.replace(/-/g, '.') + (record.localTime ? '  ' + record.localTime : ''),
      metrics: metrics.map((m) => ({
        ...metricParts(project, m, record[m]!),
        label: m === 'quantity' ? '本次数量' : '本次时间',
      })),
      note: record.note,
      // Never disclose sibling records on a single-record poster.
      summary: '',
      count: '',
      filename: `polaris-record-${record.occurredOn}`,
    });
  } else {
    const s = statistics(rows, selection.metric, selection.period, selection.offset, today);
    const heat =
      selection.graph === 'calendar'
        ? calendarHeatmap(rows, selection.metric, selection.calendarOffset, today)
        : null;
    const selected = heat ? heat.selected : s.selected;
    const start = heat ? heat.month + '-01' : s.start;
    const end = heat ? [...heat.cells].reverse().find((c) => c.inside && !c.future)!.date : s.end;
    const added = total(selected, selection.metric),
      cumulative = selection.graph === 'cumulative';
    const missing =
      (cumulative ? rows.filter((r) => r.occurredOn <= end) : selected).length > 0 &&
      !(cumulative ? rows.filter((r) => r.occurredOn <= end) : selected).some(
        (r) => r[selection.metric] != null,
      );
    const factor = selection.metric === 'durationSeconds' ? factors[p.timeUnit] : 1;
    Object.assign(snapshot, {
      graph: selection.graph,
      title: { cumulative: '累计统计', distribution: '分布统计', calendar: '日历统计' }[
        selection.graph
      ],
      date: start.replace(/-/g, '.') + ' — ' + end.replace(/-/g, '.'),
      metrics: [
        {
          ...(missing
            ? { number: '—', unit: metricParts(p, selection.metric, 0).unit }
            : metricParts(p, selection.metric, cumulative ? s.baseline + added : added)),
          label: cumulative ? '当前累计' : '本期新增',
        },
      ],
      // A historical chart needs an explicit cutoff so current does not imply today's total.
      summary: cumulative
        ? '截至 ' +
          (end > today ? today : end).replace(/-/g, '.') +
          ' · 本期新增 ' +
          metricText(p, selection.metric, added)
        : '按发生日期统计实际投入',
      count:
        selected.length +
        ' 条记录 · ' +
        new Set(selected.filter((r) => (r[selection.metric] || 0) > 0).map((r) => r.occurredOn))
          .size +
        ' 个投入日',
      filename: `polaris-${selection.graph}-${start}`,
      values: s.points.map((pt) => (cumulative ? pt.cumulative : pt.added) / factor),
      labels: s.points.map((pt) => pt.label),
      baseline: s.baseline / factor,
      cells: heat
        ? heat.cells.map((c) => ({
            day: c.day,
            level: c.level,
            future: c.future,
            missing: c.missing,
          }))
        : [],
    });
  }
  // Describe only what is printed; hidden analytical metadata must not clutter the accessible preview.
  snapshot.description = [
    snapshot.name,
    snapshot.title,
    snapshot.date,
    ...snapshot.metrics.map((m) => m.label + m.number + m.unit),
  ].join('，');
  return snapshot;
}

export interface ShareRequest {
  selection: ShareSelection;
  version: string;
  snapshot: ShareSnapshot;
}
let pending: { token: string; request: ShareRequest } | null = null;
let serial = 0;
/** Only a short opaque token crosses navigation. Results, notes and local IDs never enter a public share URL. */
export function beginShare(db: Database, selection: ShareSelection): string {
  const token = `${Date.now()}-${++serial}`;
  pending = {
    token,
    request: {
      selection: { ...selection },
      version: shareSourceVersion(db, selection.projectId),
      snapshot: shareSnapshot(db, selection),
    },
  };
  return token;
}
/** Consume once so restarting or opening a copied preview URL cannot accidentally reveal an earlier result. */
export function takeShare(token: string): ShareRequest | null {
  if (!pending || pending.token !== token) return null;
  const request = pending.request;
  pending = null;
  return request;
}
