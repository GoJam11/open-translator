import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { trackPageview } from '../../src/analytics';
import './style.css';

void trackPageview('/popup');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
