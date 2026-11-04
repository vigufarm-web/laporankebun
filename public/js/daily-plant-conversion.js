import {landStage} from './daily-catalog.js';

// The helper changes only the form input. The saved report remains in hectares.
export function usesPlantCount(division, activity, unit) {
  return division === 'Pisang' && unit === 'ha' && ['Tanam', 'Stik Tanam'].includes(landStage(activity));
}
export function plantCountToHa(value) {
  if (value === '' || value == null) return '';
  const plants = Number(value);
  if (!Number.isSafeInteger(plants) || plants < 0) return null;
  return Number((plants / 2000).toFixed(6));
}
