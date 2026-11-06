import { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { FullPageSpinner } from '@/components/common/FullPageSpinner';
import { AdminLayout, AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { GuestRoute, ProtectedRoute, RoleRoute } from '@/routes/guards';
import { CatalogPage } from '@/pages/CatalogPage';
import { CourseDetailPage } from '@/pages/CourseDetailPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ForbiddenPage, NotFoundPage, RouteErrorBoundary } from '@/pages/ErrorPages';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { LessonPage } from '@/pages/LessonPage';
import { LoginPage } from '@/pages/LoginPage';
import { MyLearningPage } from '@/pages/MyLearningPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { RegisterPage } from '@/pages/RegisterPage';

/**
 * Route table.
 *
 * Guards are nested rather than repeated per route, so a new admin page
 * cannot be added without inheriting the ADMIN check. The guards are a
 * navigation aid only: the API enforces the same rules independently.
 *
 * The admin pages are code-split. They pull in the charting library, which is
 * the single largest dependency in the app and is of no use to a learner, so
 * loading it on demand keeps it out of the learner bundle entirely.
 */
const AdminOverviewPage = lazy(() =>
  import('@/pages/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
);
const AdminActivityPage = lazy(() =>
  import('@/pages/admin/AdminActivityPage').then((m) => ({ default: m.AdminActivityPage })),
);
const AdminCoursesPage = lazy(() =>
  import('@/pages/admin/AdminCoursesPage').then((m) => ({ default: m.AdminCoursesPage })),
);
const AdminCourseEditorPage = lazy(() =>
  import('@/pages/admin/AdminCourseEditorPage').then((m) => ({
    default: m.AdminCourseEditorPage,
  })),
);
const AdminLearnersPage = lazy(() =>
  import('@/pages/admin/AdminLearnersPage').then((m) => ({ default: m.AdminLearnersPage })),
);
const AdminLearnerDetailPage = lazy(() =>
  import('@/pages/admin/AdminLearnersPage').then((m) => ({
    default: m.AdminLearnerDetailPage,
  })),
);

/** Wraps a lazily loaded page so the chunk fetch has a visible fallback. */
const lazyPage = (element: React.ReactNode) => (
  <Suspense fallback={<FullPageSpinner label="Loading" />}>{element}</Suspense>
);

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      // --- guest only --------------------------------------------------
      {
        element: <GuestRoute />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              { path: '/login', element: <LoginPage /> },
              { path: '/register', element: <RegisterPage /> },
              { path: '/forgot-password', element: <ForgotPasswordPage /> },
            ],
          },
        ],
      },

      // --- signed in ----------------------------------------------------
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Navigate to="/dashboard" replace /> },
              { path: '/dashboard', element: <DashboardPage /> },
              { path: '/courses', element: <CatalogPage /> },
              { path: '/courses/:slug', element: <CourseDetailPage /> },
              { path: '/courses/:slug/lessons/:lessonId', element: <LessonPage /> },
              { path: '/my-learning', element: <MyLearningPage /> },
              { path: '/profile', element: <ProfilePage /> },
              { path: '/403', element: <ForbiddenPage /> },
            ],
          },

          // --- admin only -------------------------------------------------
          {
            element: <RoleRoute allow={['ADMIN']} />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  { path: '/admin', element: lazyPage(<AdminOverviewPage />) },
                  { path: '/admin/activity', element: lazyPage(<AdminActivityPage />) },
                  { path: '/admin/courses', element: lazyPage(<AdminCoursesPage />) },
                  {
                    path: '/admin/courses/:id/lessons',
                    element: lazyPage(<AdminCourseEditorPage />),
                  },
                  { path: '/admin/learners', element: lazyPage(<AdminLearnersPage />) },
                  { path: '/admin/learners/:id', element: lazyPage(<AdminLearnerDetailPage />) },
                  // The artifact's "Settings" nav item is the profile page.
                  { path: '/admin/settings', element: <ProfilePage /> },
                ],
              },
            ],
          },
        ],
      },

      // --- catch-all ----------------------------------------------------
      {
        element: <AppLayout />,
        children: [{ path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
]);
