export const daysBetween = (start: Date, end: Date) => Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
