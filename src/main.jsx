import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import React from 'react'
import DrawVsAI from './drawVsAI.jsx'
import SanityCheckWebcam from './webcamcheck.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {/* <SanityCheckWebcam></SanityCheckWebcam> */}
  </StrictMode>,
)
