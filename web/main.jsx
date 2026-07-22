/* Website entry point. The Artifact build renders StudyFeed.jsx directly;
   here we mount it ourselves. Same component either way. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../StudyFeed.jsx';

createRoot(document.getElementById('root')).render(<App />);
