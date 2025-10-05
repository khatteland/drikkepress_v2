
import en from '@/lang/en.json'
type Dict = typeof en
let current: Dict = en
export const t = (path: string): string => {
  const parts = path.split('.')
  let ref: any = current
  for(const p of parts){ ref = ref?.[p]; if(ref===undefined) return path }
  return String(ref)
}
