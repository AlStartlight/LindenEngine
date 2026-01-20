import React from 'react'
import ReactDOM from 'react-dom/client'
import { EditorLayout } from '@editor/EditorLayout'
import './App.css'

const App: React.FC = () => {
  return <EditorLayout />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
