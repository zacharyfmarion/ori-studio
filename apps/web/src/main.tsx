import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter, setAppRouter } from './routing/appRouter';
import './index.css';
import './styles/theme.css';
import './App.css';

const router = createAppRouter();
setAppRouter(router);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
