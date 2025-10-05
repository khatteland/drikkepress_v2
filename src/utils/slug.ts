
export const sluggify = (s: string) =>
  s.toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/[^a-z0-9\s-]/g,'')
    .trim().replace(/\s+/g,'-').replace(/-+/g,'-')
