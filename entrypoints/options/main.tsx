import React from 'react';
import ReactDOM from 'react-dom/client';
import OptionsApp from './App.tsx';
import { trackPageview } from '../../src/analytics';
import './style.css';

void trackPageview('/options');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
