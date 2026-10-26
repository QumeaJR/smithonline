import { Component, type ErrorInfo, type ReactNode } from 'react';
import { readSavedDesign } from '../lib/autosave';
import { newDesignFromDefaults, openedDesign } from '../lib/designBuild';
import { useDesignStore } from '../store/useDesignStore';
import { Button } from './ui/Button';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/** The share link leaves the address bar, so a reload does not open the same design again. */
function dropShareLink(): void {
  try {
    if (location.hash.startsWith('#d=')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch {
    // No history API: the link stays, the design is replaced all the same.
  }
}

/**
 * Around the application shell: when rendering throws (a design holding a value
 * no view expected), a recovery message with two ways out takes the place of the
 * blank page React would leave.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Smith Online could not show the design', error, info.componentStack);
  }

  private loadSaved = (): void => {
    const saved = readSavedDesign();
    dropShareLink();
    if (saved) useDesignStore.getState().init(openedDesign(saved).design);
    else this.startNew();
    this.setState({ error: null });
  };

  private startNew = (): void => {
    dropShareLink();
    useDesignStore.getState().init(newDesignFromDefaults(), { fresh: true });
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const raw = error.message.trim() || 'an unexpected error';
    const reason = raw.length > 300 ? `${raw.slice(0, 299)}…` : raw;
    return (
      <div className="app-error" role="alert">
        <h1>Smith Online</h1>
        <p>{`This design could not be shown: ${reason}.`}</p>
        <p>Load the last saved design, or start a new one.</p>
        <div className="app-error-actions">
          <Button variant="primary" onClick={this.loadSaved}>
            Load the last saved design
          </Button>
          <Button onClick={this.startNew}>Start a new design</Button>
        </div>
      </div>
    );
  }
}
