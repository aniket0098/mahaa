/**
 * Time-of-day greeting — one implementation shared by both role homes so the
 * two shells cannot drift. Deterministic and locale-independent.
 */
export function greeting(name: string): string {
  const firstName = name.trim().split(/\s+/)[0] ?? name;
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${firstName}`;
}