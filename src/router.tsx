import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/app-layout'
import { routeTable } from '@/config/routes'
import { NotFoundPage } from '@/pages/not-found'

// Every route comes from the table, so a leaf's path is defined in one place.
const routes = routeTable.flatMap((group) =>
  group.items.flatMap((item) => ('children' in item ? item.children : [item]))
)

// A data router is required for `handle` and `useMatches`, which the header
// uses to read the current page title.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/mint/tasks" replace /> },
      ...routes.map((route) => ({
        path: route.path,
        element: route.element,
        handle: { title: route.title },
      })),
      { path: '*', element: <NotFoundPage />, handle: { title: 'Not found' } },
    ],
  },
])
