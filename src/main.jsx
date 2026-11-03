import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import sourceSansLatinUrl from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url';
import './index.css';
import App from './App.jsx';

const fontPreload = document.createElement('link');
fontPreload.rel = 'preload';
fontPreload.as = 'font';
fontPreload.type = 'font/woff2';
fontPreload.crossOrigin = 'anonymous';
fontPreload.href = sourceSansLatinUrl;
document.head.append(fontPreload);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);