// Begraenser hvor ofte en fremdriftsmelding sendes. Med Content-Length paa
// modelfilerne kalder transformers.js fremdriftsfunktionen for hvert eneste
// stykke data (ca. 6.000 gange ved opstart), og hver melding blev til en
// IPC-besked, en opdatering af statuslinjen og en linje i loggen.
//
// Sender kun naar procenten har aendret sig OG der er gaaet mindst `ms`
// siden sidste afsendelse. `tving` sender altid, fx ved 100 %.
export function statusTrottle(send, { ms = 250, now = () => performance.now() } = {}) {
  let sidsteTid = -Infinity;
  let sidstePct = null;
  const trottle = (pct, tving = false) => {
    const t = now();
    if (!tving && (pct === sidstePct || t - sidsteTid < ms)) return false;
    sidsteTid = t;
    sidstePct = pct;
    send(pct);
    return true;
  };
  trottle.nulstil = () => {
    sidsteTid = -Infinity;
    sidstePct = null;
  };
  return trottle;
}
