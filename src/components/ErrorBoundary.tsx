import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps one broken hero from blanking the page: the hero picker stays usable. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render failed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="state error" role="alert" data-testid="render-error">
          <strong>Something went wrong while drawing this hero.</strong>
          {this.state.error.message}
          <br />
          Pick another hero, or reload the page.
        </div>
      );
    }
    return this.props.children;
  }
}
