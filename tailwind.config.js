
/** @type {import('tailwindcss').Config} */
export default {
  content:['./index.html','./src/**/*.{ts,tsx}'],
  theme:{
    extend:{
      colors:{
        ink:'var(--dp-ink)',
        orange:'var(--dp-orange)',
        cream:'var(--dp-cream)',
        teal:'var(--dp-teal)'
      },
      boxShadow:{ soft:'0 10px 30px rgba(0,0,0,0.08)'}
    }
  },
  plugins:[]
}
