/** Colours for element loci and ladder badges, handed out when an element is created. */
export const ARC_COLORS = ['#d6336c', '#1c7ed6', '#2f9e44', '#f08c00', '#7048e8', '#0ca678'];

/** The least-used colour among the existing elements, so a new element stands out. */
export function nextColor(existing: ReadonlyArray<{ readonly color: string }>): string {
  const counts = ARC_COLORS.map((c) => existing.filter((e) => e.color === c).length);
  const min = Math.min(...counts);
  return ARC_COLORS[counts.indexOf(min)] ?? ARC_COLORS[0]!;
}

/** Colour by position, for designs loaded from files that carry no colours. */
export function colorByIndex(index: number): string {
  return ARC_COLORS[index % ARC_COLORS.length]!;
}
