import { describe, it, expect } from 'vitest';
import { mindsteCanvas, CANVAS_KANT_CM } from '../src/printmaal.js';

describe('laerredets kant i Crop', () => {
  it('det mindste canvas i hvert format; et liggende format er det staaende vendt', () => {
    expect(CANVAS_KANT_CM).toBe(4.5);
    expect(mindsteCanvas('1:1')).toEqual({ bredde: 30, hoejde: 30 });
    expect(mindsteCanvas('2:3')).toEqual({ bredde: 30, hoejde: 45 });
    expect(mindsteCanvas('3:2')).toEqual({ bredde: 45, hoejde: 30 });
    expect(mindsteCanvas('1:2')).toEqual({ bredde: 30, hoejde: 60 });
    expect(mindsteCanvas('2:1')).toEqual({ bredde: 60, hoejde: 30 });
    expect(mindsteCanvas('free')).toBeNull();
  });
});
