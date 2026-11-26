import { iconSource } from '../../application/appearance';

/** Local Phosphor Regular assets preserve the original geometry and avoid platform-dependent glyphs. */
Component({
  data: { source: '/assets/icons/muted/target.svg' },
  properties: {
    name: { type: String, value: 'target' },
    tone: { type: String, value: 'muted' },
    size: { type: Number, value: 18 },
  },
  observers: {
    'name,tone'(name: string, tone: string) {
      // The generator owns the allowed pairs; fallback cannot point at a pruned color variant.
      this.setData({ source: iconSource(name, tone) });
    },
  },
});
