
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '@/routes/App'
import '@/styles.css'
import '@fontsource/inter'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App/>
    </BrowserRouter>
  </StrictMode>
)
