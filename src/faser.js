// Arbejdet gaar i seks faser, og man staar i én ad gangen. Fasen er ikke en
// status man saetter; den foelger af hvor filerne ligger.
export const FASER = [
  [1, 'Sort'], [2, 'Edit'], [3, 'Crop'], [4, 'Print'], [5, 'Product'], [6, 'Shop'],
];

// Hver fase sin farve, fra varm i Sort til koelig i Shop. Den aktive fases
// farve er appens accent, saa fanen, markeringen og knapperne foelger med.
export const FASEFARVE = {
  1: '#e0673f', 2: '#d39a2a', 3: '#4fae4f', 4: '#239f9b', 5: '#4a7fe0', 6: '#9361d6',
};
