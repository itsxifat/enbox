import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { Button, EmptyState, buttonClasses } from '@/components/ui';

/** Error boundary for the route tree. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (!notFound) console.error(error);
  return (
    <div className="flex h-dvh items-center justify-center bg-app">
      <EmptyState
        icon={TriangleAlert}
        title={notFound ? 'Page not found' : 'Something went wrong'}
        description={
          notFound
            ? "This page doesn't exist."
            : 'An unexpected error occurred. Reloading usually fixes it.'
        }
        action={
          <>
            {!notFound ? <Button onClick={() => window.location.reload()}>Reload</Button> : null}
            <Link to="/chats" className={buttonClasses(notFound ? 'primary' : 'ghost')}>
              Go to chats
            </Link>
          </>
        }
      />
    </div>
  );
}

/** In-shell 404 for unknown authenticated paths. */
export function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center bg-app">
      <EmptyState
        icon={TriangleAlert}
        title="Page not found"
        description="This page doesn't exist or has moved."
        action={
          <Link to="/chats" className={buttonClasses('primary')}>
            Go to chats
          </Link>
        }
      />
    </div>
  );
}
