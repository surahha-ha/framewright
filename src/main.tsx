import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// NOTE: StrictMode intentionally omitted — its dev-mode double-invoke of effects
// double-fires the decode pipeline and causes flicker in a media app.
const el = document.getElementById('root');
if (!el) throw new Error('#root not found');
createRoot(el).render(<App />);
