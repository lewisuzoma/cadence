import { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { FullPageSpinner } from '@/components/common/FullPageSpinner';
import { AdminLayout, AppLayout } from '@/layouts/AppLayout';
import { InstructorLayout } from '@/layouts/InstructorLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import {
  GuestRoute,
  PermissionRoute,
  ProtectedRoute,
  RoleRoute,
} from '@/routes/guards';
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
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';

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

/*
 * The instructor workspace is code-split for the same reason the admin
 * area is: it is a substantial amount of UI — charts, drag-and-drop, the
 * uploader — that a learner never opens. Keeping it out of the main
 * bundle costs one `Suspense` and saves every learner the download.
 */
const BecomeInstructorPage = lazy(() =>
  import('@/pages/instructor/BecomeInstructorPage').then((m) => ({
    default: m.BecomeInstructorPage,
  })),
);
const ApplicationStatusPage = lazy(() =>
  import('@/pages/instructor/ApplicationStatusPage').then((m) => ({
    default: m.ApplicationStatusPage,
  })),
);
const InstructorDashboardPage = lazy(() =>
  import('@/pages/instructor/InstructorDashboardPage').then((m) => ({
    default: m.InstructorDashboardPage,
  })),
);
const MyCoursesPage = lazy(() =>
  import('@/pages/instructor/MyCoursesPage').then((m) => ({ default: m.MyCoursesPage })),
);
const CourseFormPage = lazy(() =>
  import('@/pages/instructor/CourseFormPage').then((m) => ({ default: m.CourseFormPage })),
);
const ManageLessonsPage = lazy(() =>
  import('@/pages/instructor/ManageLessonsPage').then((m) => ({
    default: m.ManageLessonsPage,
  })),
);
const CoursePreviewPage = lazy(() =>
  import('@/pages/instructor/CoursePreviewPage').then((m) => ({
    default: m.CoursePreviewPage,
  })),
);
const CourseAnalyticsPage = lazy(() =>
  import('@/pages/instructor/CourseAnalyticsPage').then((m) => ({
    default: m.CourseAnalyticsPage,
  })),
);
const CourseLearnersPage = lazy(() =>
  import('@/pages/instructor/CourseLearnersPage').then((m) => ({
    default: m.CourseLearnersPage,
  })),
);
const LearnerProgressPage = lazy(() =>
  import('@/pages/instructor/LearnerProgressPage').then((m) => ({
    default: m.LearnerProgressPage,
  })),
);
const InstructorProfilePage = lazy(() =>
  import('@/pages/instructor/InstructorProfilePage').then((m) => ({
    default: m.InstructorProfilePage,
  })),
);
const AdminApplicationsPage = lazy(() =>
  import('@/pages/admin/AdminApplicationsPage').then((m) => ({
    default: m.AdminApplicationsPage,
  })),
);
const AdminApplicationDetailPage = lazy(() =>
  import('@/pages/admin/AdminApplicationsPage').then((m) => ({
    default: m.AdminApplicationDetailPage,
  })),
);
const AdminInstructorsPage = lazy(() =>
  import('@/pages/admin/AdminInstructorsPage').then((m) => ({
    default: m.AdminInstructorsPage,
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
              { path: '/reset-password', element: <ResetPasswordPage /> },
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

              // Applying is a learner activity, so it lives in the learner
              // shell rather than the teaching one — which does not exist
              // for the person filling this in.
              {
                path: '/become-an-instructor',
                element: lazyPage(<BecomeInstructorPage />),
              },
              {
                path: '/become-an-instructor/edit',
                element: lazyPage(<BecomeInstructorPage />),
              },
              {
                path: '/instructor-application',
                element: lazyPage(<ApplicationStatusPage />),
              },

              { path: '/403', element: <ForbiddenPage /> },
            ],
          },

          // --- the teaching workspace -------------------------------------
          // Guarded by capability, not role: a suspended instructor still
          // reaches these routes and is shown the explanation page, while
          // a learner is sent to 403.
          {
            element: <PermissionRoute require="instructor:dashboard" />,
            children: [
              {
                element: <InstructorLayout />,
                children: [
                  { path: '/instructor', element: lazyPage(<InstructorDashboardPage />) },
                  { path: '/instructor/courses', element: lazyPage(<MyCoursesPage />) },
                  {
                    path: '/instructor/courses/new',
                    element: lazyPage(<CourseFormPage />),
                  },
                  {
                    path: '/instructor/courses/:id',
                    element: lazyPage(<CourseFormPage />),
                  },
                  {
                    path: '/instructor/courses/:id/lessons',
                    element: lazyPage(<ManageLessonsPage />),
                  },
                  {
                    path: '/instructor/courses/:id/preview',
                    element: lazyPage(<CoursePreviewPage />),
                  },
                  {
                    path: '/instructor/analytics',
                    element: lazyPage(<CourseAnalyticsPage />),
                  },
                  {
                    path: '/instructor/courses/:id/analytics',
                    element: lazyPage(<CourseAnalyticsPage />),
                  },
                  {
                    path: '/instructor/courses/:id/learners',
                    element: lazyPage(<CourseLearnersPage />),
                  },
                  {
                    path: '/instructor/courses/:id/learners/:userId',
                    element: lazyPage(<LearnerProgressPage />),
                  },
                  {
                    path: '/instructor/profile',
                    element: lazyPage(<InstructorProfilePage />),
                  },
                ],
              },
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
                  {
                    path: '/admin/instructor-applications',
                    element: lazyPage(<AdminApplicationsPage />),
                  },
                  {
                    path: '/admin/instructor-applications/:id',
                    element: lazyPage(<AdminApplicationDetailPage />),
                  },
                  {
                    path: '/admin/instructors',
                    element: lazyPage(<AdminInstructorsPage />),
                  },
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
