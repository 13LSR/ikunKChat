import React, { lazy, Suspense, useEffect } from 'react';
import { AppProviders } from './components/app/AppProviders';
import { AppContainer } from './components/app/AppContainer';
import { preloadIkunVideo } from './utils/ikunVideo';

const AdminApp = lazy(() => import('./components/admin/AdminApp'));

/**
 * App - Root component
 * Sets up providers and renders the main application
 */
export default function App() {
  const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

  useEffect(() => {
    if (!isAdminRoute) void preloadIkunVideo();
  }, [isAdminRoute]);

  if (isAdminRoute) {
    return (
      <Suspense fallback={<div className="admin-route-loading">正在加载管理员后台…</div>}>
        <AdminApp />
      </Suspense>
    );
  }

  return (
    <AppProviders>
      <AppContainer />
    </AppProviders>
  );
}
