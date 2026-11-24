/** Local SVG assets keep one stroke language and avoid platform-dependent emoji glyphs. */
Component({
  properties: {
    name: { type: String, value: 'target' },
    tone: { type: String, value: 'ink' },
    size: { type: Number, value: 18 },
  },
});
