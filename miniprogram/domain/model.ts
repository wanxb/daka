/** Stable domain entry point: consumers keep the same exports while each invariant has one owning module.
 * Domain implementations import their owners directly so this compatibility facade cannot introduce cycles.
 */
export * from './types';
export * from './values';
export * from './project';
export * from './records';
export * from './calendar';
export { palettes, type Color } from './appearance';
