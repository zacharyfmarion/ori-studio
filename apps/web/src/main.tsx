import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppErrorBoundary } from './components/errors/AppErrorBoundary';
import { createAppRouter, setAppRouter } from './routing/appRouter';
import './i18n';
import './index.css';
import './styles/theme.css';
import './App.css';

const router = createAppRouter();
setAppRouter(router);

// The outermost boundary. The router has its own `errorElement` for everything
// inside the route tree; this only catches what is above or around it, so that
// a failure there is still a readable, copyable report rather than a blank page.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </StrictMode>
);
