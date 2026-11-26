import {
  dateKey,
  initialForm,
  makeProject,
  moveDay,
  validateRecord,
  type Database,
  type PracticeRecord,
  type ProjectForm,
} from '../domain/model';

/** First-use fixtures become ordinary local records, so cards and every statistics view share one source. */
export function initialData(now: number): Pick<Database, 'projects' | 'records'> {
  const today = dateKey(new Date(now));
  const presets: { form: Partial<ProjectForm>; minutes: number[]; quantities: number[] }[] = [
    {
      form: {
        id: 'p_initial_reading',
        name: '阅读',
        color: 'purple',
        icon: 'book',
        quantityEnabled: true,
        quantityUnit: '页',
        defaultTime: '25',
        defaultQuantity: '18',
      },
      minutes: [20, 30, 0, 25, 35, 15, 25],
      quantities: [12, 20, 0, 16, 24, 10, 18],
    },
    {
      form: {
        id: 'p_initial_rope',
        name: '跳绳',
        color: 'orange',
        icon: 'rope',
        timeEnabled: false,
        quantityEnabled: true,
        primaryMetric: 'quantity',
        quantityMax: '3000',
        defaultQuantity: '1000',
      },
      minutes: [],
      quantities: [600, 1000, 800, 0, 1200, 900, 1000],
    },
    {
      form: {
        id: 'p_initial_exercise',
        name: '运动',
        color: 'teal',
        icon: 'dumbbell',
        defaultTime: '30',
      },
      minutes: [30, 0, 20, 40, 25, 45, 30],
      quantities: [],
    },
  ];
  const projects = presets.map(({ form }) => makeProject({ ...initialForm(), ...form }, now));
  const records: PracticeRecord[] = [];
  presets.forEach((preset, index) => {
    const project = projects[index];
    // Calendar arithmetic crosses months, years and DST safely; zero means a rest day, never a zero-value record.
    for (let day = 0; day < 7; day++) {
      const minutes = preset.minutes[day] || 0;
      const quantity = preset.quantities[day] || 0;
      if (!minutes && !quantity) continue;
      const record: PracticeRecord = {
        id: `${project.id}_day_${day}`,
        projectId: project.id,
        occurredOn: moveDay(today, day - 6),
        // Leave the optional clock time empty rather than inventing a future session on today's date.
        localTime: '',
        durationSeconds: minutes ? minutes * 60 : null,
        quantity: quantity || null,
        quantityUnit: quantity ? project.quantityUnit : null,
        note: '',
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      validateRecord(record, project, today);
      records.push(record);
      if (quantity) project.quantityUnitLocked = true;
    }
  });
  return { projects, records };
}
