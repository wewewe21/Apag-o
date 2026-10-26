// A superfície sonora corresponde ao piso visível; paredes de tijolo não são piso.
export const FOOTSTEP_MIX = Object.freeze({ local: 0.45, remote: 0.5, creatureWalk: 0.95, creatureRun: 1.1, creatureSurface: 0.42 });
const MATERIALS = { lino: 'lino', linoleum: 'lino', tile: 'tile', checker: 'tile', morgue: 'tile', terrazzo: 'stone', stone: 'stone', concrete: 'concrete', brick: 'brick', asphalt: 'asphalt', wood: 'wood', water: 'water' };
export function footstepMaterial(surface) { return MATERIALS[surface] || 'concrete'; }
export function footstepSurfaceAt(game, x, z) {
  const grid = game.grid;
  if (grid?.char?.(grid.cellX(x), grid.cellY(z)) === '=') return 'concrete';
  const zone = game.zoneAtPos?.(x, z) || grid?.zoneCfg?.(grid.cellX(x), grid.cellY(z));
  return zone?.water ? 'water' : zone?.floor || 'concrete';
}
