// Colour a multiple: above 1× is up since the call, below is down.
export function tone(value) {
  if (value === null || value === 1) return '';
  return value > 1 ? 'gain' : 'loss';
}
