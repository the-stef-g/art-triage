import { useSyncExternalStore } from 'react';
import { invoke, onEvent } from './api';

// Koeen til shoppen, som hovedprocessen ser den. Én lytter for hele appen;
// panelet, knapperne og bundlinjen laeser herfra.
let tilstand = { vaerker: [], koerer: false, fremdrift: null, start: null };
const lyttere = new Set();
let startet = false;

function saet(t) {
  tilstand = t;
  lyttere.forEach((l) => l());
}

function start() {
  if (startet) return;
  startet = true;
  onEvent((evt) => {
    if (evt.type === 'shopKoe') {
      const { type, ...t } = evt;
      saet(t);
    }
  });
  invoke('shop:koe').then(saet).catch(() => {});
}

function abonner(l) {
  start();
  lyttere.add(l);
  return () => lyttere.delete(l);
}

export function useKoe() {
  return useSyncExternalStore(abonner, () => tilstand);
}

export const koeTilfoej = (imageIds, kobl = null) => invoke('shop:koeTilfoej', { imageIds, kobl });
export const koeFjern = (id) => invoke('shop:koeFjern', { id });
export const koeRyd = () => invoke('shop:koeRyd');

// Hvor langt et vaerk er naaet, fra 0 til 1.
export function vaerkDel(f) {
  if (!f?.dele) return 0;
  return Math.max(0, Math.min(1, (f.del || 0) / f.dele));
}

// Hele koerslen: de vaerker der er lagt i, siden koeen sidst var tom.
export function koersel(t) {
  const med = t.vaerker.filter((k) => k.koersel);
  const faerdige = med.filter((k) => k.status !== 'venter' && k.status !== 'sender').length;
  const sender = med.find((k) => k.status === 'sender');
  const del = med.length ? (faerdige + (sender ? vaerkDel(t.fremdrift) : 0)) / med.length : 0;
  return { ialt: med.length, faerdige, nr: faerdige + (sender ? 1 : 0), del };
}

export function mb(bytes) {
  return (bytes / 1e6).toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function varighed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function klokken(ms) {
  return new Date(ms).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}
