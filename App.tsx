import React, { useEffect } from 'react';
import { AppProviders } from './components/app/AppProviders';
import { AppContainer } from './components/app/AppContainer';
import { preloadIkunVideo } from './utils/ikunVideo';

/**
 * App - Root component
 * Sets up providers and renders the main application
 */
export default function App() {
  useEffect(() => {
    void preloadIkunVideo();
  }, []);

  return (
    <AppProviders>
      <AppContainer />
    </AppProviders>
  );
}
